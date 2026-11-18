from io import BytesIO
from typing import Any

from PIL import Image, UnidentifiedImageError


MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_MEDIA_TYPES = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}


class InvalidImageError(ValueError):
    pass


def validate_image(content: bytes, declared_type: str) -> str:
    if not content:
        raise InvalidImageError("The selected image is empty.")
    if len(content) > MAX_IMAGE_BYTES:
        raise InvalidImageError("Each image must be 8 MB or smaller.")
    expected_format = ALLOWED_MEDIA_TYPES.get(declared_type.lower())
    if expected_format is None:
        raise InvalidImageError("Use a JPEG, PNG, or WebP image.")
    try:
        with Image.open(BytesIO(content)) as image:
            actual_format = image.format
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise InvalidImageError("The uploaded file is not a valid image.") from error
    if actual_format != expected_format:
        raise InvalidImageError("The image content does not match its file type.")
    if width > 6000 or height > 6000 or width * height > 20_000_000:
        raise InvalidImageError("Image dimensions must be 6,000 pixels or smaller on each side.")
    return expected_format


def detect_pose(content: bytes) -> dict[str, Any]:
    try:
        import cv2
        import mediapipe as mp
        import numpy as np
    except ImportError:
        return {
            "available": False,
            "reason": "Pose landmark processing is not installed on this server.",
            "landmarks": [],
        }

    image = cv2.imdecode(
        np.frombuffer(content, dtype=np.uint8),
        cv2.IMREAD_COLOR,
    )
    if image is None:
        raise InvalidImageError("The server could not decode this image.")
    height, width = image.shape[:2]
    with mp.solutions.pose.Pose(
        static_image_mode=True,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
    ) as pose:
        result = pose.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    if not result.pose_landmarks:
        return {"available": True, "detected": False, "landmarks": []}
    landmarks = [
        {
            "name": mp.solutions.pose.PoseLandmark(index).name.lower(),
            "x": round(point.x, 5),
            "y": round(point.y, 5),
            "z": round(point.z, 5),
            "visibility": round(point.visibility, 5),
            "pixel_x": round(point.x * width),
            "pixel_y": round(point.y * height),
        }
        for index, point in enumerate(result.pose_landmarks.landmark)
    ]
    return {"available": True, "detected": True, "landmarks": landmarks}
