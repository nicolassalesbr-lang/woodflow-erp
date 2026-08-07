import cv2
import numpy as np
from os import PathLike
from typing import Union

ImageInput = Union[str, PathLike, np.ndarray]


def preprocess_image(image_input: ImageInput, deskew: bool = True):
    """
    Applies OpenCV preprocessing techniques tailored for architectural plans and dimensions.

    Accepts either a filesystem path or an image already loaded as a NumPy array.
    The OCR pipeline uses arrays for both uploaded images and rendered PDF pages.
    """
    if isinstance(image_input, np.ndarray):
        image = image_input.copy()
    else:
        image = cv2.imread(str(image_input))

    if image is None:
        raise ValueError(f"Could not read image: {image_input}")

    # Convert to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
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
            if abs(angle) > 0.5:
                (h, w) = image.shape[:2]
                center = (w // 2, h // 2)
                M = cv2.getRotationMatrix2D(center, angle, 1.0)
                gray = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    
    # Adaptive Thresholding (Binarization) to isolate black text on white background
    # Since plans are usually white background with black lines, we invert or threshold carefully
    processed = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
    )
    
    # Optional: Sharpening to make small numbers more readable
    kernel = np.array([[0, -1, 0], [-1, 5,-1], [0, -1, 0]])
    sharpened = cv2.filter2D(processed, -1, kernel)
    
    return sharpened
