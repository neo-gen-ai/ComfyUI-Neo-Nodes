# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes - Model Loaders
# Part 1: Model Loaders (from ComfyUI-UNetLoader)

import os
import torch
import folder_paths
import comfy.sd  # type: ignore[attr-defined]
import comfy.utils


class ModelLoaderHelper:
    """模型加载器辅助类，提供目录扫描和过滤功能"""
    
    @staticmethod
    def get_directories_and_files(folder_name):
        """
        获取指定模型目录的所有子目录和文件
        
        Returns:
            tuple: (目录列表, 文件列表)
        """
        all_files = folder_paths.get_filename_list(folder_name)
        
        # 获取所有唯一的目录
        directories = set()
        for file in all_files:
            # 统一使用 / 作为分隔符
            normalized = file.replace("\\", "/")
            if "/" in normalized:
                dir_name = normalized.split("/")[0]
                directories.add(dir_name)
        
        # 目录列表（__all__ 表示全部）
        dir_list = ["__all__"]
        for dir in sorted(directories):
            dir_list.append(dir)
        
        return dir_list, all_files


class UNetLoaderWithPrefix:
    """自定义 UNet 加载器，支持目录前缀过滤功能。"""
    
    @classmethod
    def INPUT_TYPES(cls):
        dir_list, all_files = ModelLoaderHelper.get_directories_and_files("diffusion_models")
        
        return {
            "required": {
                "model_directory": (dir_list, {
                    "tooltip": "选择模型目录，__all__ 表示显示所有模型"
                }),
                "unet_name": (all_files, {"tooltip": "要加载的扩散模型文件"}),
                "weight_dtype": (
                    ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],
                    {
                        "advanced": True,
                        "tooltip": "模型权重数据类型"
                    }
                ),
            }
        }
    
    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "load_unet"
    CATEGORY = "model/loaders"
    DESCRIPTION = "加载扩散模型（UNet），支持目录前缀过滤以便快速选择特定目录下的模型"
    
    def load_unet(self, model_directory="__all__", unet_name="", weight_dtype="default"):
        model_options = {}
        
        if weight_dtype == "fp8_e4m3fn":
            model_options["dtype"] = torch.float8_e4m3fn
        elif weight_dtype == "fp8_e4m3fn_fast":
            model_options["dtype"] = torch.float8_e4m3fn
            model_options["fp8_optimizations"] = True
        elif weight_dtype == "fp8_e5m2":
            model_options["dtype"] = torch.float8_e5m2
        
        if model_directory and model_directory != "__all__":
            full_path = f"{model_directory}/{unet_name}"
        else:
            full_path = unet_name
        
        unet_path = folder_paths.get_full_path_or_raise("diffusion_models", full_path)
        model = comfy.sd.load_diffusion_model(unet_path, model_options=model_options)
        return (model,)


class CheckpointLoaderWithPrefix:
    """自定义 Checkpoint 加载器，支持目录前缀过滤功能。"""
    
    @classmethod
    def INPUT_TYPES(cls):
        dir_list, all_files = ModelLoaderHelper.get_directories_and_files("checkpoints")
        
        return {
            "required": {
                "model_directory": (dir_list, {
                    "tooltip": "选择模型目录，__all__ 表示显示所有模型"
                }),
                "ckpt_name": (all_files, {"tooltip": "要加载的检查点模型文件"}),
            }
        }
    
    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("model", "clip", "vae")
    OUTPUT_TOOLTIPS = (
        "用于去噪潜图的扩散模型",
        "用于编码文本提示的 CLIP 模型",
        "用于编码和解码图像的 VAE 模型"
    )
    FUNCTION = "load_checkpoint"
    CATEGORY = "model/loaders"
    DESCRIPTION = "加载检查点模型，支持目录前缀过滤以便快速选择特定目录下的模型"
    
    def load_checkpoint(self, model_directory="__all__", ckpt_name=""):
        if model_directory and model_directory != "__all__":
            full_path = f"{model_directory}/{ckpt_name}"
        else:
            full_path = ckpt_name
        
        ckpt_path = folder_paths.get_full_path_or_raise("checkpoints", full_path)
        out = comfy.sd.load_checkpoint_guess_config(
            ckpt_path,
            output_vae=True,
            output_clip=True,
            embedding_directory=folder_paths.get_folder_paths("embeddings")
        )
        return out[:3]


class LoraLoaderWithPrefix:
    """自定义 LoRA 加载器，支持目录前缀过滤功能。仅支持模型参数，不包含 CLIP。"""
    
    @classmethod
    def INPUT_TYPES(cls):
        dir_list, all_files = ModelLoaderHelper.get_directories_and_files("loras")
        
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "要应用 LoRA 的扩散模型"}),
                "model_directory": (dir_list, {
                    "tooltip": "选择模型目录，__all__ 表示显示所有模型"
                }),
                "lora_name": (all_files, {"tooltip": "LoRA 模型文件"}),
                "strength_model": ("FLOAT", {
                    "default": 1.0, 
                    "min": -100.0, 
                    "max": 100.0, 
                    "step": 0.01,
                    "tooltip": "模型强度"
                }),
            }
        }
    
    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "load_lora"
    CATEGORY = "model/loaders"
    DESCRIPTION = "加载 LoRA 模型，支持目录前缀过滤以便快速选择特定目录下的模型（仅模型参数，不包含 CLIP）"
    
    def load_lora(self, model, model_directory="__all__", lora_name="", strength_model=1.0):
        if strength_model == 0:
            return (model,)
        
        if model_directory and model_directory != "__all__":
            full_path = f"{model_directory}/{lora_name}"
        else:
            full_path = lora_name
        
        lora_path = folder_paths.get_full_path_or_raise("loras", full_path)
        lora, lora_metadata = comfy.utils.load_torch_file(
            lora_path, safe_load=True, return_metadata=True
        )
        
        model_lora = comfy.sd.load_lora_for_models(  # type: ignore
            model, None, lora, strength_model, 0, lora_metadata=lora_metadata
        )[0]
        return (model_lora,)


# Node Class Mappings
NODE_CLASS_MAPPINGS = {
    "UNetLoaderWithPrefix": UNetLoaderWithPrefix,
    "CheckpointLoaderWithPrefix": CheckpointLoaderWithPrefix,
    "LoraLoaderWithPrefix": LoraLoaderWithPrefix,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "UNetLoaderWithPrefix": "Neo UNet Loader (目录过滤)",
    "CheckpointLoaderWithPrefix": "Neo Checkpoint Loader (目录过滤)",
    "LoraLoaderWithPrefix": "Neo LoRA Loader (目录过滤)",
}