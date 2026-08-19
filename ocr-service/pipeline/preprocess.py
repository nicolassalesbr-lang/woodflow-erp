import cv2
import numpy as np
from typing import Union

def preprocess_image(image_input: Union[str, np.ndarray], deskew: bool = True) -> np.ndarray:
    """
    Applies OpenCV preprocessing techniques tailored for architectural plans and dimensions,
    specifically avoiding destructive binarization (like adaptive threshold) on photos and 
    applying 2x upscaling to help OCR models with small texts.
    
    Args:
        image_input: A string path to an image OR a numpy array (BGR format).
        deskew: Whether to attempt automatic deskewing.
    Returns:
        Processed image as a numpy array.
    """
    if isinstance(image_input, str):
        image = cv2.imread(image_input)
        if image is None:
            raise ValueError(f"Could not read image from path: {image_input}")
    elif isinstance(image_input, np.ndarray):
        image = image_input
    else:
        raise TypeError("image_input must be a file path (str) or a numpy array.")

    # 1. Upscale (2x) to increase readability of small texts/dimensions for OCR
    (h, w) = image.shape[:2]
    # Limit max size to avoid memory exhaustion on already huge images
    if max(h, w) < 4000:
        image = cv2.resize(image, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)

    # 2. Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # 3. Deskew
    if deskew:
        # Simple deskew logic
        coords = np.column_stack(np.where(gray > 0))
        if len(coords) > 0:
            angle = cv2.minAreaRect(coords)[-1]
            if angle < -45:
                angle = -(90 + angle)
            else:
                angle = -angle
            
            # Deskew if angle is significant
            if abs(angle) > 0.5 and abs(angle) < 45:
                (h_g, w_g) = gray.shape[:2]
                center = (w_g // 2, h_g // 2)
                M = cv2.getRotationMatrix2D(center, angle, 1.0)
                gray = cv2.warpAffine(gray, M, (w_g, h_g), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    
    # 4. Enhance contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization)
    # This prevents artifacts in photos with shadows/gradients that standard thresholding causes
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    
    # 5. Convert back to BGR since PaddleOCR usually expects BGR/RGB 3-channel input internally 
    # (even though grayscale works, standardizing output shape is safer)
    processed_bgr = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
    
    return processed_bgr


def build_image_ocr_variants(image_input: Union[str, np.ndarray]) -> list[tuple[str, np.ndarray]]:
    """Create OCR inputs tailored to technical drawings uploaded as images.

    Architectural screenshots frequently use red dimension strings and arrows.  A
    greyscale pass weakens that signal, so keep the regular pass and add a second
    image where only red annotations remain.  This is intentionally used only by
    image uploads; PDF processing keeps its existing pipeline unchanged.
    """
    if isinstance(image_input, str):
        image = cv2.imread(image_input)
        if image is None:
            raise ValueError(f"Could not read image from path: {image_input}")
    elif isinstance(image_input, np.ndarray):
        image = image_input.copy()
    else:
        raise TypeError("image_input must be a file path (str) or a numpy array.")

    # Do not deskew screenshots/plants here: the previous full-canvas heuristic
    # sees the white paper as foreground and can rotate valid drawings. The
    # regular pass performs the shared 2x upscale, so the red mask below stays
    # in the same coordinate system.
    full = preprocess_image(image, deskew=False)
    variants: list[tuple[str, np.ndarray]] = [("full", full)]

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    low_red = cv2.inRange(hsv, np.array([0, 55, 55]), np.array([16, 255, 255]))
    high_red = cv2.inRange(hsv, np.array([164, 55, 55]), np.array([180, 255, 255]))
    red_mask = cv2.bitwise_or(low_red, high_red)

    # Keep small characters connected without turning the dimension lines into
    # a thick block. PaddleOCR reads dark text on a light surface reliably.
    red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))
    if cv2.countNonZero(red_mask) > 100:
        red_only = np.full(image.shape[:2], 255, dtype=np.uint8)
        red_only[red_mask > 0] = 0
        variants.append(("red_dimensions", cv2.cvtColor(red_only, cv2.COLOR_GRAY2BGR)))

    return variants
