from paddleocr import PaddleOCR
import numpy as np

# Singleton instance to keep model in memory
_ocr_instance = None

def get_ocr():
    global _ocr_instance
    if _ocr_instance is None:
        _ocr_instance = PaddleOCR(
            use_angle_cls=True, 
            lang='pt', 
            use_gpu=False, # PADDLEOCR_USE_GPU
            show_log=False,
            # PADDLEOCR_ENABLE_ANGLE_CLASSIFICATION is covered by use_angle_cls
        )
    return _ocr_instance

def run_paddle_ocr(image_array: np.ndarray, page_num: int = 1, file_id: str = "unknown"):
    """
    Runs PaddleOCR on a numpy array image and returns structured data.
    """
    ocr = get_ocr()
    result = ocr.ocr(image_array, cls=True)
    
    extracted_items = []
    
    if result is None or len(result) == 0 or result[0] is None:
        return extracted_items
        
    for line in result[0]:
        box = line[0]
        txt = line[1][0]
        confidence = line[1][1]
        
        # box is a list of 4 points: [[x1,y1], [x2,y1], [x2,y2], [x1,y2]]
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        
        extracted_items.append({
            "text": txt,
            "normalized_text": txt, # Further normalization done in Node.js or here
            "confidence": confidence,
            "bounding_box": {
                "x1": min(xs),
                "y1": min(ys),
                "x2": max(xs),
                "y2": max(ys)
            },
            "page": page_num,
            "source_file_id": file_id,
            "extraction_method": "paddleocr"
        })
        
    return extracted_items
