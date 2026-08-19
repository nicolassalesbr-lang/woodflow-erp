from paddleocr import PaddleOCR
import cv2
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
    """
    Runs PaddleOCR on a numpy array image and returns structured data.
    """
    ocr = get_ocr()
    extracted_items = []
    height, width = image_array.shape[:2]

    for orientation in orientations:
        result = ocr.ocr(_rotate(image_array, orientation), cls=True)
        if result is None or len(result) == 0 or result[0] is None:
            continue

        for line in result[0]:
            box = line[0]
            txt = str(line[1][0]).strip()
            confidence = float(line[1][1])
            if not txt or confidence < 0.55:
                continue

            original_points = [_to_original(point, width, height, orientation) for point in box]
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
