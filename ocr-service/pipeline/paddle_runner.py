from paddleocr import PaddleOCR
import numpy as np

# Singleton instance to keep model in memory
_ocr_instance = None


def _create_ocr():
    """Create the PaddleOCR 3.x engine with stable CPU settings."""
    return PaddleOCR(
        lang="pt",
        device="cpu",
        enable_mkldnn=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=True,
    )


def get_ocr():
    global _ocr_instance
    if _ocr_instance is None:
        _ocr_instance = _create_ocr()
    return _ocr_instance


def run_paddle_ocr(image_array: np.ndarray, page_num: int = 1, file_id: str = "unknown"):
    """
    Runs PaddleOCR on a numpy array image and returns structured data.
    """
    ocr = get_ocr()
    result = ocr.predict(image_array)

    extracted_items = []

    if not result or result[0] is None:
        return extracted_items

    page_result = result[0]
    texts = page_result.get("rec_texts", [])
    scores = page_result.get("rec_scores", [])
    polygons = page_result.get("rec_polys", [])

    for txt, confidence, box in zip(texts, scores, polygons):
        box_array = np.asarray(box)
        if box_array.size == 0:
            continue

        # box is a list of 4 points: [[x1,y1], [x2,y1], [x2,y2], [x1,y2]]
        xs = box_array[:, 0]
        ys = box_array[:, 1]

        extracted_items.append({
            "text": txt,
            "normalized_text": txt, # Further normalization done in Node.js or here
            "confidence": float(confidence),
            "bounding_box": {
                "x1": float(np.min(xs)),
                "y1": float(np.min(ys)),
                "x2": float(np.max(xs)),
                "y2": float(np.max(ys))
            },
            "page": page_num,
            "source_file_id": file_id,
            "extraction_method": "paddleocr"
        })
        
    return extracted_items
