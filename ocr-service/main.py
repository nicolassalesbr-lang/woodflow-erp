import os
import shutil
import re
import tempfile
import uvicorn
from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Any, List, Optional

# Placeholders for future imports
# from pipeline.extractor import extract_pdf
# from pipeline.paddle_runner import run_ocr

app = FastAPI(title="KazaHome OCR Service", description="Local PaddleOCR microservice for WoodFlow ERP")

class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

class ExtractedItem(BaseModel):
    text: str
    normalized_text: str
    confidence: float
    bounding_box: BoundingBox
    page: int
    source_file_id: str
    extraction_method: str
    variant: Optional[str] = None
    orientation: Optional[int] = None

class OCRResponse(BaseModel):
    pages: int
    contexts: List[str]
    items: List[ExtractedItem]
    status: str


def _looks_like_measurement(text: str) -> bool:
    compact = re.sub(r"\s+", "", text.lower())
    return bool(re.search(r"\d", compact)) and bool(re.fullmatch(
        r"(?:[lap]=?)?[øφ]?[+-]?\d{1,5}(?:[.,]\d{1,3})?(?:mm|cm|m)?(?:x\d{1,5}(?:[.,]\d{1,3})?(?:mm|cm|m)?){0,2}",
        compact,
    ))


def _dedupe_items(items: list[dict]) -> list[dict]:
    """Merge native/Paddle repetitions while retaining the best evidence."""
    best: dict[str, dict] = {}
    for item in items:
        box = item["bounding_box"]
        text_key = re.sub(r"\s+", "", item["text"].lower())
        cx = round((box["x1"] + box["x2"]) / 48)
        cy = round((box["y1"] + box["y2"]) / 48)
        key = f'{item["page"]}:{text_key}:{cx}:{cy}'
        previous = best.get(key)
        if previous is None or item["confidence"] > previous["confidence"]:
            best[key] = item
    return list(best.values())


def _native_layer_is_reliable(blocks: list[dict]) -> bool:
    texts = [block.get("text", "") for block in blocks]
    char_count = sum(len(text) for text in texts)
    if char_count >= 80:
        return True
    # Covers can be intentionally sparse while still containing an exact text
    # layer. OCR adds no dimensional evidence on those pages.
    joined = " ".join(texts)
    return char_count >= 40 and bool(re.search(r"clientes|detalhamento de projeto", joined, re.IGNORECASE))


def _page_context(
    native_blocks: list[dict],
    ocr_items: list[dict],
    width: float,
    height: float,
    native_width: Optional[float] = None,
    native_height: Optional[float] = None,
) -> str:
    native_text = [block["text"] for block in native_blocks]
    ocr_text = [item["text"] for item in ocr_items if item.get("variant") == "full"]
    sheet_identity = [text for text in native_text if re.search(
        r"clientes|detalhamento|fachada|área|area|despensa|cozinha|layout|vista\s*\d|\d+\s*\|\s*\d+",
        text,
        re.IGNORECASE,
    )]
    dimensions = []
    positioned_blocks = []
    if native_blocks:
        native_width = native_width or max((block["bbox"][2] for block in native_blocks), default=1)
        native_height = native_height or max((block["bbox"][3] for block in native_blocks), default=1)
        for block in native_blocks:
            x1, y1, x2, y2 = block["bbox"]
            direction = block.get("direction") or (1.0, 0.0)
            orientation = "vertical" if abs(direction[1]) > abs(direction[0]) else "horizontal"
            normalized_x = ((x1 + x2) / 2) / native_width
            normalized_y = ((y1 + y2) / 2) / native_height
            region = "carimbo" if normalized_y > 0.82 else "desenho"
            clean_text = re.sub(r"\s+", " ", block["text"]).replace("|", "/").strip()
            if clean_text and region == "desenho":
                positioned_blocks.append(
                    f'"{clean_text[:140]}"@({normalized_x:.3f},{normalized_y:.3f});'
                    f'orient={orientation};fonte=pdf_vetorial'
                )
            if not _looks_like_measurement(block["text"]):
                continue
            dimensions.append(
                f'{block["text"]}@({normalized_x:.3f},'
                f'{normalized_y:.3f});conf=1.00;orient={orientation};'
                f'regiao={region};fonte=pdf_vetorial'
            )
    for item in ocr_items:
        if not _looks_like_measurement(item["text"]):
            continue
        box = item["bounding_box"]
        x = ((box["x1"] + box["x2"]) / 2) / max(width, 1)
        y = ((box["y1"] + box["y2"]) / 2) / max(height, 1)
        region = "carimbo" if y > 0.82 else "desenho"
        dimensions.append(
            f'{item["text"]}@({x:.3f},{y:.3f});conf={item["confidence"]:.2f};'
            f'rot={item.get("orientation", 0)};regiao={region};fonte={item.get("variant", "full")}'
        )

    # Dimension evidence comes first so dense title blocks cannot truncate it.
    parts = []
    if sheet_identity:
        parts.append("IDENTIFICACAO DA FOLHA:\n" + " | ".join(sheet_identity[:30]))
    if dimensions:
        parts.append(
            "COTAS COM POSICAO/CONFIANCA (numeros sem unidade nas linhas de cota estao em cm):\n"
            + " | ".join(dimensions[:240])
        )
    if positioned_blocks:
        parts.append(
            "BLOCOS VETORIAIS POSICIONADOS (texto@(x,y); use para associar cada cota ao contorno/vista correto):\n"
            + " | ".join(positioned_blocks[:320])
        )
    if native_text:
        parts.append("TEXTO VETORIAL:\n" + " | ".join(native_text)[:5000])
    if ocr_text:
        parts.append("TEXTO OCR VISUAL:\n" + " | ".join(ocr_text)[:5000])
    return "\n\n".join(parts)[:24000]

@app.post("/analyze", response_model=OCRResponse)
async def analyze_document(file: UploadFile = File(...)):
    """
    Analyzes a PDF or image file and returns structured OCR data and contexts for GPT Vision.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")

    suffix = os.path.splitext(file.filename)[1].lower()
    temp_handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_path = temp_handle.name
    temp_handle.close()
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        from pipeline.extractor import extract_pdf_native
        
        is_image = file.filename.lower().endswith(('.jpg', '.jpeg', '.png'))
        
        contexts = []
        items_all = []

        native_pages = None if is_image else extract_pdf_native(temp_path)
        def process_page(page_index: int, image: Any = None) -> None:
            native_page = native_pages[page_index] if native_pages else {}
            native_blocks = native_page.get("blocks", [])
            # Vector PDFs provide exact glyphs and coordinates. OCR is a fallback
            # for scanned/outlined pages, not a competing source that can distort
            # already exact dimensions and multiply processing time.
            reliable_native_layer = _native_layer_is_reliable(native_blocks)
            extracted_items = []
            if not reliable_native_layer:
                if image is None:
                    raise ValueError(f"Page {page_index + 1} needs OCR but was not rendered")
                from pipeline.paddle_runner import run_paddle_ocr
                from pipeline.preprocess import build_image_ocr_variants
                variants = build_image_ocr_variants(image)
                for variant_name, variant_image in variants:
                    extracted_items.extend(run_paddle_ocr(
                        variant_image,
                        page_num=page_index + 1,
                        file_id=file.filename,
                        variant=variant_name,
                        orientations=(0, 90, 270),
                    ))
            extracted_items = _dedupe_items(extracted_items)
            items_all.extend(extracted_items)
            height, width = image.shape[:2] if image is not None else (1, 1)
            contexts.append(_page_context(
                native_blocks,
                extracted_items,
                width,
                height,
                native_page.get("width"),
                native_page.get("height"),
            ))

        if is_image:
            import cv2
            image = cv2.imread(temp_path)
            if image is None:
                raise ValueError(f"Could not read image: {temp_path}")
            process_page(0, image)
        else:
            # Process one rendered page at a time. A 13-page A3 drawing at 300
            # DPI can otherwise consume more than 1 GB before OCR even starts.
            import fitz
            document = fitz.open(temp_path)
            try:
                for page_index, page in enumerate(document):
                    native_page = native_pages[page_index] if native_pages else {}
                    if _native_layer_is_reliable(native_page.get("blocks", [])):
                        process_page(page_index, None)
                        continue
                    import cv2
                    import numpy as np
                    pix = page.get_pixmap(dpi=300, alpha=False)
                    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                    process_page(page_index, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
            finally:
                document.close()
            
        return OCRResponse(
            pages=len(contexts),
            contexts=contexts,
            items=items_all,
            status="completed"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
