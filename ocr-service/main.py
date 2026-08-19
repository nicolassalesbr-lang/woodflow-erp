import os
import shutil
import re
import tempfile
import uvicorn
from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import List, Optional

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


def _page_context(native_blocks: list[dict], ocr_items: list[dict], width: float, height: float) -> str:
    native_text = [block["text"] for block in native_blocks]
    ocr_text = [item["text"] for item in ocr_items if item.get("variant") == "full"]
    dimensions = []
    for item in ocr_items:
        if not _looks_like_measurement(item["text"]):
            continue
        box = item["bounding_box"]
        x = ((box["x1"] + box["x2"]) / 2) / max(width, 1)
        y = ((box["y1"] + box["y2"]) / 2) / max(height, 1)
        dimensions.append(
            f'{item["text"]}@({x:.3f},{y:.3f});conf={item["confidence"]:.2f};'
            f'rot={item.get("orientation", 0)};fonte={item.get("variant", "full")}'
        )

    # Dimension evidence comes first so dense title blocks cannot truncate it.
    parts = []
    if dimensions:
        parts.append("COTAS OCR COM POSICAO/CONFIANCA:\n" + " | ".join(dimensions[:180]))
    if native_text:
        parts.append("TEXTO VETORIAL:\n" + " | ".join(native_text)[:5000])
    if ocr_text:
        parts.append("TEXTO OCR VISUAL:\n" + " | ".join(ocr_text)[:5000])
    return "\n\n".join(parts)[:14000]

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
        from pipeline.paddle_runner import run_paddle_ocr
        from pipeline.preprocess import build_image_ocr_variants
        import cv2
        import numpy as np
        
        is_image = file.filename.lower().endswith(('.jpg', '.jpeg', '.png'))
        
        contexts = []
        items_all = []

        native_pages = None if is_image else extract_pdf_native(temp_path)
        def process_page(page_index: int, image: np.ndarray) -> None:
            variants = build_image_ocr_variants(image)
            extracted_items = []
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
            native_blocks = native_pages[page_index]["blocks"] if native_pages else []
            height, width = variants[0][1].shape[:2]
            contexts.append(_page_context(native_blocks, extracted_items, width, height))

        if is_image:
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
