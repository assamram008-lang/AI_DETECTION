import io

import pytest
from PIL import Image

from backend.scanner import InvalidImageError, validate_image


def png_bytes() -> bytes:
    data = io.BytesIO()
    Image.new("RGB", (4, 4), "white").save(data, format="PNG")
    return data.getvalue()


def test_validate_image_checks_declared_type_against_content():
    assert validate_image(png_bytes(), "image/png") == "PNG"
    with pytest.raises(InvalidImageError, match="does not match"):
        validate_image(png_bytes(), "image/jpeg")


def test_validate_image_rejects_empty_and_unsupported_content():
    with pytest.raises(InvalidImageError, match="empty"):
        validate_image(b"", "image/png")
    with pytest.raises(InvalidImageError, match="not a valid image"):
        validate_image(b"not an image", "image/png")
    with pytest.raises(InvalidImageError, match="JPEG, PNG, or WebP"):
        validate_image(b"content", "image/svg+xml")
