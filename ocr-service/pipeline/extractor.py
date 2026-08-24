import fitz  # PyMuPDF

def extract_pdf_native(file_path: str):
    """
    Extracts native text and bounding boxes from a PDF using PyMuPDF.
    Returns None if the PDF doesn't contain valid textual data (e.g. it's just a scanned image).
    """
    doc = fitz.open(file_path)
    pages_data = []
    
    total_text_length = 0
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        text_dict = page.get_text("dict")
        
        blocks = []
        for block in text_dict.get("blocks", []):
            if block.get("type") == 0:  # Text block
                for line in block.get("lines", []):
                    direction = line.get("dir", (1.0, 0.0))
                    for span in line.get("spans", []):
                        text = span.get("text", "").strip()
                        if text:
                            total_text_length += len(text)
                            bbox = span.get("bbox")  # (x0, y0, x1, y1)
                            blocks.append({
                                "text": text,
                                "bbox": bbox,
                                "direction": direction,
                                "font_size": span.get("size"),
                                "color": span.get("color"),
                            })
        
        pages_data.append({
            "page_num": page_num + 1,
            "width": page.rect.width,
            "height": page.rect.height,
            "blocks": blocks
        })
        
    doc.close()
    
    # Simple heuristic to check if PDF is natively textual
    if total_text_length < 50:
        return None
        
    return pages_data
