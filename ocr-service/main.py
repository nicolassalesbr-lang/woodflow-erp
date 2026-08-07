import os
import shutil
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

class OCRResponse(BaseModel):
    pages: int
    contexts: List[str]
    items: List[ExtractedItem]
    status: str

@app.post("/analyze", response_model=OCRResponse)
async def analyze_document(file: UploadFile = File(...)):
    """
    Analyzes a PDF or image file and returns structured OCR data and contexts for GPT Vision.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")

    temp_dir = "./temp"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, file.filename)
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        from pipeline.extractor import extract_pdf_native
        from pipeline.paddle_runner import run_paddle_ocr
        from pipeline.preprocess import preprocess_image
        import cv2
        import numpy as np
        
        is_image = file.filename.lower().endswith(('.jpg', '.jpeg', '.png'))
        
        if is_image:
            pages_data = None
        else:
            # 1. Tentar extração nativa via PyMuPDF
            pages_data = extract_pdf_native(temp_path)
        
        contexts = []
        items_all = []
        
        if pages_data is not None:
            # Texto extraído nativamente (PDF Vetorial)
            for page in pages_data:
                texts = [b["text"] for b in page["blocks"]]
                cotas = []
                w = page["width"]
                h = page["height"]
                for b in page["blocks"]:
                    t = b["text"].strip()
                    if any(char.isdigit() for char in t):
                        box = b["bbox"] # (x0, y0, x1, y1)
                        x_norm = ((box[0] + box[2]) / 2) / w
                        y_norm = ((box[1] + box[3]) / 2) / h
                        cotas.append(f"{t}@({x_norm:.2f},{y_norm:.2f})")
                        
                page_ctx = []
                if texts: page_ctx.append(f"TEXTO OCR (NATIVO):\n{' | '.join(texts)[:3500]}")
                if cotas: page_ctx.append(f"COTAS (valor@posição x,y normalizada 0-1):\n{'; '.join(cotas[:90])}")
                contexts.append('\n\n'.join(page_ctx))
        else:
            # Falha na extração nativa ou é uma imagem, usar OCR
            images_to_process = []
            if is_image:
                img_array = cv2.imread(temp_path)
                if img_array is None:
                    raise ValueError(f"Could not read image: {temp_path}")
                images_to_process.append(img_array)
            else:
                import fitz
                doc = fitz.open(temp_path)
                for page_num in range(len(doc)):
                    page = doc[page_num]
                    pix = page.get_pixmap(dpi=300)
                    
                    # Converter pixmap para numpy array (OpenCV format BGR)
                    img_array = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                    if pix.n == 4:
                        img_array = cv2.cvtColor(img_array, cv2.COLOR_RGBA2BGR)
                    elif pix.n == 1:
                        img_array = cv2.cvtColor(img_array, cv2.COLOR_GRAY2BGR)
                    elif pix.n == 3:
                        img_array = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
                    images_to_process.append(img_array)
                doc.close()
                
            for page_num, img_array in enumerate(images_to_process):
                # Preprocessamento (OpenCV)
                processed_img = preprocess_image(img_array, deskew=True)
                
                # OCR (PaddleOCR)
                extracted_items = run_paddle_ocr(processed_img, page_num=page_num+1, file_id=file.filename)
                items_all.extend(extracted_items)
                
                # Montar contexto para a LLM
                texts = [item["text"] for item in extracted_items]
                cotas = []
                
                h_img, w_img = processed_img.shape[:2]
                for item in extracted_items:
                    t = item["text"].strip()
                    if any(char.isdigit() for char in t):
                        box = item["bounding_box"]
                        x_norm = ((box["x1"] + box["x2"]) / 2) / w_img
                        y_norm = ((box["y1"] + box["y2"]) / 2) / h_img
                        cotas.append(f"{t}@({x_norm:.2f},{y_norm:.2f})")
                        
                page_ctx = []
                if texts: page_ctx.append(f"TEXTO OCR:\n{' | '.join(texts)[:3500]}")
                if cotas: page_ctx.append(f"COTAS (valor@posição x,y normalizada 0-1):\n{'; '.join(cotas[:90])}")
                contexts.append('\n\n'.join(page_ctx))
            
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
