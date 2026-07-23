# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes - Image Loaders
# 图像加载节点，支持使用大模型反推图像描述

import os
import io
import torch
import numpy as np
import folder_paths
import hashlib
import logging
from PIL import Image, ImageOps, ImageSequence

logger = logging.getLogger(__name__)

# 从 llm 模块导入 LLM 相关功能
from .llm import run_llm_task, get_llm_instance

# ==========================================
# Image Loader with LLM Description
# ==========================================

class NeoImageLoader:
    """图像加载节点，支持使用大模型反推图像描述"""
    
    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["image"])
        
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            },
            "optional": {
                "system_prompt": ("STRING", {"forceInput": True}),
                "description_style": (["默认", "简约", "详细"], {
                    "default": "默认",
                    "tooltip": "描述风格：默认=标准描述，简约=简短精炼，详细=丰富细节"
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
            }
        }
    
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("IMAGE", "DESCRIPTION")
    FUNCTION = "load_image"
    CATEGORY = "Neo-Nodes"
    DESCRIPTION = "加载图像，使用大模型反推图像描述"

    def load_image(self, image, description_style="默认", system_prompt="", prompt=None):
        image_path = folder_paths.get_annotated_filepath(image)
        
        # 加载图像
        img = Image.open(image_path)
        img = ImageOps.exif_transpose(img)
        if img is None:
            logger.error(f"Failed to load image: {image_path}")
            return None
        img = img.convert("RGB") 
        
        # 转换为 tensor
        image_array = np.array(img).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array)[None,]
        
        # 检查 LLM 是否支持多模态
        llm_instance = get_llm_instance()
        has_mmproj = llm_instance.has_mmproj
        
        # 根据风格选择任务名称
        task_name_map = {
            "默认": "describe_image",
            "简约": "describe_image_concise",
            "详细": "describe_image_detailed",
        }
        task_name = task_name_map.get(description_style, "describe_image")
        
        # 自定义系统提示词：优先使用连接的输入
        extra_system_prompt = system_prompt if system_prompt else None
        
        # 执行大模型反推图像描述
        description = ""
        try:
            user_text = "请描述这张图像的内容"
            
            # 如果支持多模态，传递图像数据
            images = None
            if has_mmproj:
                # 缩放图像以减少 token 消耗（多模态模型通常有最大尺寸限制）
                # Qwen-VL 推荐最大 1024x1024，这里使用 768 作为平衡点
                max_llm_size = 768
                img_for_llm = img.copy()
                if img_for_llm.width > max_llm_size or img_for_llm.height > max_llm_size:
                    img_for_llm.thumbnail((max_llm_size, max_llm_size))
                    logger.info(f"Resized image from {img.size} to {img_for_llm.size} for LLM")
                
                # 将 PIL 图像转换为字节流
                img_bytes = io.BytesIO()
                img_for_llm.save(img_bytes, format='JPEG', quality=85)
                img_bytes.seek(0)
                images = [img_bytes.read()]
            
            result = run_llm_task(task_name, user_text, extra_system_prompt=extra_system_prompt, images=images)
            
            if result.get("status") == "success":
                description = result.get("description", "")
                logger.info(f"Generated description: {description[:100]}...")
            else:
                logger.warning(f"Failed to generate description: {result.get('error', 'Unknown error')}")
                
        except Exception as e:
            logger.error(f"Error generating description: {e}")
            description = ""
        
        # 生成预览图像
        preview_image = img.copy()
        max_size = 512
        preview_image.thumbnail((max_size, max_size))
        
        # 保存到临时目录以便预览
        import random
        output_dir = folder_paths.get_temp_directory()
        prefix = "_neo_preview_" + ''.join(random.choice("abcdefghijklmnopqrstupvxyz") for x in range(5))
        filename_prefix = prefix
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, output_dir, preview_image.size[0], preview_image.size[1]
        )
        
        file = f"{filename}_{counter:05}_.png"
        preview_image.save(os.path.join(full_output_folder, file), compress_level=1)
        
        return {
            "ui": {
                "images": [{"filename": file, "subfolder": subfolder, "type": "temp"}],
                "description": [description]
            },
            "result": (image_tensor, description)
        }

    @classmethod
    def IS_CHANGED(cls, image):
        image_path = folder_paths.get_annotated_filepath(image)
        m = hashlib.sha256()
        with open(image_path, 'rb') as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        if not folder_paths.exists_annotated_filepath(image):
            return "Invalid image file: {}".format(image)
        return True


class NeoImageLoaderFromPath:
    """从本地路径加载图像，并可选使用大模型反推描述"""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "图像的本地路径"
                }),
            },
            "optional": {
                "system_prompt": ("STRING", {"forceInput": True}),
                "description_style": (["默认", "简约", "详细"], {
                    "default": "默认",
                    "tooltip": "描述风格：默认=标准描述，简约=简短精炼，详细=丰富细节"
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
            }
        }
    
    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("IMAGE", "DESCRIPTION")
    FUNCTION = "load_image_from_path"
    CATEGORY = "Neo-Nodes"
    DESCRIPTION = "从本地路径加载图像，并使用大模型反推图像描述"

    def load_image_from_path(self, path="", description_style="默认", system_prompt="", prompt=None):
        if not path:
            logger.error("Path is empty")
            return None
        
        if not os.path.exists(path):
            logger.error(f"Image file not found: {path}")
            return None
        
        # 加载图像
        try:
            img = Image.open(path)
            img = ImageOps.exif_transpose(img)
            if img is None:
                logger.error(f"Failed to load image: {path}, image is None")
                return None
            img = img.convert("RGB")
        except Exception as e:
            logger.error(f"Failed to load image: {e}")
            return None
        
        # 转换为 tensor
        image_array = np.array(img).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_array)[None,]
        
        # 检查 LLM 是否支持多模态
        llm_instance = get_llm_instance()
        has_mmproj = llm_instance.has_mmproj
        
        # 根据风格选择任务名称
        task_name_map = {
            "默认": "describe_image",
            "简约": "describe_image_concise",
            "详细": "describe_image_detailed",
        }
        task_name = task_name_map.get(description_style, "describe_image")
        
        # 自定义系统提示词：优先使用连接的输入
        extra_system_prompt = system_prompt if system_prompt else None
        
        # 执行大模型反推图像描述
        description = ""
        try:
            user_text = "请描述这张图像的内容"
            
            # 如果支持多模态，传递图像数据
            images = None
            if has_mmproj:
                # 缩放图像以减少 token 消耗（多模态模型通常有最大尺寸限制）
                # Qwen-VL 推荐最大 1024x1024，这里使用 768 作为平衡点
                max_llm_size = 768
                img_for_llm = img.copy()
                if img_for_llm.width > max_llm_size or img_for_llm.height > max_llm_size:
                    img_for_llm.thumbnail((max_llm_size, max_llm_size))
                    logger.info(f"Resized image from {img.size} to {img_for_llm.size} for LLM")
                
                # 将 PIL 图像转换为字节流
                img_bytes = io.BytesIO()
                img_for_llm.save(img_bytes, format='JPEG', quality=85)
                img_bytes.seek(0)
                images = [img_bytes.read()]
            
            result = run_llm_task(task_name, user_text, extra_system_prompt=extra_system_prompt, images=images)
            
            if result.get("status") == "success":
                description = result.get("description", "")
                logger.info(f"Generated description: {description[:100]}...")
            else:
                logger.warning(f"Failed to generate description: {result.get('error', 'Unknown error')}")
                
        except Exception as e:
            logger.error(f"Error generating description: {e}")
            description = ""
        
        # 生成预览图像
        preview_image = img.copy()
        max_size = 512
        preview_image.thumbnail((max_size, max_size))
        
        # 保存到临时目录以便预览
        import random
        output_dir = folder_paths.get_temp_directory()
        prefix = "_neo_preview_" + ''.join(random.choice("abcdefghijklmnopqrstupvxyz") for x in range(5))
        filename_prefix = prefix
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, output_dir, preview_image.size[0], preview_image.size[1]
        )
        
        file = f"{filename}_{counter:05}_.png"
        preview_image.save(os.path.join(full_output_folder, file), compress_level=1)
        
        return {
            "ui": {
                "images": [{"filename": file, "subfolder": subfolder, "type": "temp"}],
                "description": [description]
            },
            "result": (image_tensor, description)
        }


# ==========================================
# Node Class Mappings
# ==========================================
NODE_CLASS_MAPPINGS = {
    "NeoImageLoader": NeoImageLoader,
    "NeoImageLoaderFromPath": NeoImageLoaderFromPath,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NeoImageLoader": "Neo Image Loader (自动反推)",
    "NeoImageLoaderFromPath": "Neo Image Loader (路径）自动反推",
}