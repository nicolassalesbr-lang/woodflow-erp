from paddleocr import PaddleOCR
import cv2
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


def _rotate(image: np.ndarray, orientation: int) -> np.ndarray:
    if orientation == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if orientation == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    if orientation == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image


def _to_original(point: list[float], width: int, height: int, orientation: int) -> tuple[float, float]:
    x, y = point
    if orientation == 90:
        return y, height - 1 - x
    if orientation == 180:
        return width - 1 - x, height - 1 - y
    if orientation == 270:
        return width - 1 - y, x
    return x, y


def run_paddle_ocr(
    image_array: np.ndarray,
    page_num: int = 1,
    file_id: str = "unknown",
    variant: str = "full",
    orientations: tuple[int, ...] = (0,),
):
    """Run PaddleOCR 3.x on the requested orientations and return structured data."""
    ocr = get_ocr()
    extracted_items = []
    height, width = image_array.shape[:2]

    for orientation in orientations:
        result = ocr.predict(_rotate(image_array, orientation))
        if not result:
            continue
        page_result = result[0]
        if page_result is None or not hasattr(page_result, "get"):
            continue
        texts = page_result.get("rec_texts", [])
        scores = page_result.get("rec_scores", [])
        polygons = page_result.get("rec_polys", [])

        for txt, confidence, box in zip(texts, scores, polygons):
            txt = str(txt).strip()
            confidence = float(confidence)
            if not txt or confidence < 0.55:
                continue
            box_array = np.asarray(box)
            if box_array.size == 0:
                continue
            original_points = [
                _to_original([float(point[0]), float(point[1])], width, height, orientation)
                for point in box_array
            ]
            xs = [point[0] for point in original_points]
            ys = [point[1] for point in original_points]
            extracted_items.append({
                "text": txt,
                "normalized_text": txt,
                "confidence": confidence,
                "bounding_box": {
                    "x1": min(xs), "y1": min(ys), "x2": max(xs), "y2": max(ys)
                },
                "page": page_num,
                "source_file_id": file_id,
                "extraction_method": "paddleocr",
                "variant": variant,
                "orientation": orientation,
            })

    # OCR on several orientations repeats horizontal labels. Keep the most
    # confident occurrence in each spatial neighbourhood.
    best = {}
    for item in extracted_items:
        box = item["bounding_box"]
        cx = round(((box["x1"] + box["x2"]) / 2) / 24)
        cy = round(((box["y1"] + box["y2"]) / 2) / 24)
        text_key = "".join(item["text"].lower().split())
        key = f"{text_key}:{cx}:{cy}"
        if key not in best or best[key]["confidence"] < item["confidence"]:
            best[key] = item
    return list(best.values())
