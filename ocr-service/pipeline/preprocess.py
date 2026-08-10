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
