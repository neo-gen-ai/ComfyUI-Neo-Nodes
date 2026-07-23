# ComfyUI-Neo-Nodes
# Merged plugin: ComfyUI-Prompts-Simple + ComfyUI-UNetLoader + Image Loaders

# Import from model_loaders module
from .model_loaders import (
    NODE_CLASS_MAPPINGS as MODEL_LOADER_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as MODEL_LOADER_DISPLAY_NAME_MAPPINGS,
)

# Import from prompts module
from .prompts import (
    NODE_CLASS_MAPPINGS as PROMPT_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as PROMPT_DISPLAY_NAME_MAPPINGS,
)

# Import from image_loaders module
from .image_loaders import (
    NODE_CLASS_MAPPINGS as IMAGE_LOADER_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as IMAGE_LOADER_DISPLAY_NAME_MAPPINGS,
)

# Merge all node mappings
NODE_CLASS_MAPPINGS = {
    **MODEL_LOADER_CLASS_MAPPINGS,
    **PROMPT_CLASS_MAPPINGS,
    **IMAGE_LOADER_CLASS_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **MODEL_LOADER_DISPLAY_NAME_MAPPINGS,
    **PROMPT_DISPLAY_NAME_MAPPINGS,
    **IMAGE_LOADER_DISPLAY_NAME_MAPPINGS,
}

# Web directory for frontend extensions
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]