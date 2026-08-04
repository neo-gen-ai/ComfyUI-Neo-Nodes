# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes - Prompts

from __future__ import annotations

import os
import json
import server
import torch
from aiohttp import web
import threading
import logging
from pathlib import Path
from server import PromptServer

logger = logging.getLogger(__name__)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROMPTS_DIR = os.path.join(CURRENT_DIR, "prompts")
TAGS_FILE = os.path.join(PROMPTS_DIR, "_tags_index.json")
PRESETS_DIR = os.path.join(PROMPTS_DIR, "presets")
CUSTOM_DIR = os.path.join(PROMPTS_DIR, "custom")
PRESETS_TAGS_FILE = os.path.join(PRESETS_DIR, "_tags_index.json")
CUSTOM_TAGS_FILE = os.path.join(CUSTOM_DIR, "_tags_index.json")

if not os.path.exists(PROMPTS_DIR):
    os.makedirs(PROMPTS_DIR)
if not os.path.exists(PRESETS_DIR):
    os.makedirs(PRESETS_DIR)
if not os.path.exists(CUSTOM_DIR):
    os.makedirs(CUSTOM_DIR)

PENDING_PROMPTS = {}

_tags_lock = threading.Lock()

# 从 llm 模块导入 LLM 相关功能
from .llm import (
    handle_llm_api_request,
    check_model_status,
    check_all_models_status,
    start_download,
    get_available_models,
    set_current_model,
    get_remote_llm_config,
    set_remote_llm_config,
    get_current_mode,
    LLM_MODE_LOCAL,
    LLM_MODE_REMOTE,
    run_llm_task,
)


def _load_tags_index(tags_file: str = TAGS_FILE) -> dict:
    """Load tags index from the dedicated tags file."""
    if not os.path.exists(tags_file):
        return {}
    try:
        with open(tags_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, Exception) as e:
        logger.warning(f"Error loading tags index from {tags_file}: {e}")
        return {}


def _save_tags_index(index: dict, tags_file: str = TAGS_FILE) -> None:
    """Save tags index to the dedicated tags file."""
    try:
        with open(tags_file, 'w', encoding='utf-8') as f:
            json.dump(index, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving tags index to {tags_file}: {e}")


def _get_tags_file_path(source: str) -> str:
    """根据来源返回对应的标签索引文件路径"""
    if source == "presets":
        return PRESETS_TAGS_FILE
    return CUSTOM_TAGS_FILE


def _update_tags_index(prompt_name: str, tags: list[str] | None = None, source: str = "custom") -> None:
    """更新指定来源的标签索引"""
    tags_file = _get_tags_file_path(source)
    with _tags_lock:
        index = _load_tags_index(tags_file)
        if tags is None:
            index.pop(prompt_name, None)
        else:
            index[prompt_name] = tags
        _save_tags_index(index, tags_file)


def _get_tags_for_prompt(prompt_name: str, source: str = "custom") -> list:
    """获取指定来源的标签"""
    tags_file = _get_tags_file_path(source)
    index = _load_tags_index(tags_file)
    return index.get(prompt_name, [])


def _scan_prompts_recursive(base_dir: str, prefix: str = "", source: str = "custom") -> list:
    """递归扫描目录，返回 prompt 列表，支持多级子目录"""
    prompts = []
    if not os.path.exists(base_dir):
        return prompts

    for entry in sorted(os.listdir(base_dir)):
        full_path = os.path.join(base_dir, entry)
        if os.path.isdir(full_path):
            # 递归处理子目录
            sub_prefix = f"{prefix}{entry}/" if prefix else f"{entry}/"
            prompts.extend(_scan_prompts_recursive(full_path, sub_prefix, source))
        elif entry.endswith('.txt') and not entry.startswith('_'):
            name = entry[:-4]  # 去掉 .txt 后缀
            display_name = f"{prefix}{name}" if prefix else name
            mtime = os.path.getmtime(full_path)
            tags = _get_tags_for_prompt(display_name, source)
            prompts.append({
                "name": display_name,
                "tags": tags,
                "source": source,
                "_mtime": mtime
            })
    return prompts


# ==========================================
# Prompt Node Class
# ==========================================

class NeoPrompts:
    _encode_cache = {}
    _CACHE_MAX_SIZE = 50
    MIN_SIZE = (400, 300)
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "text": ("STRING", {"multiline": True, "default": "", "hidden": True}),
                "disable_text_input": ("BOOLEAN", {"default": False, "hidden": True}),
            },
            "optional": {
                "text_input": ("STRING", {"forceInput": True}),
                "instance_uid": ("STRING", {"default": "", "hidden": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("CONDITIONING",  "STRING")
    RETURN_NAMES = ("POSITIVE",  "PROMPT")
    FUNCTION = "encode_prompts"
    CATEGORY = "Neo-Nodes"
    DESCRIPTION = "AI-powered text encoder supports save/select prompt, LLM-based prompt enhancement, translation, classification, title extraction, and intelligent caching."

    def encode_prompts(self, clip, disable_text_input=False, 
                       text="", text_input=None, unique_id=None, instance_uid=""):
        
        if disable_text_input:
            current_text = text
            effective_text_input = None
        else:
            current_text = text_input if text_input is not None else text
            effective_text_input = text_input
        
        if effective_text_input is not None and instance_uid:
            PromptServer.instance.send_sync("rs.prompt.update", {
                "instance_uid": instance_uid,
                "prompt": current_text
            })
        
        cache_key = (current_text, id(clip))
        
        if cache_key in NeoPrompts._encode_cache:
            pos_cond, neg_cond = NeoPrompts._encode_cache[cache_key]
        else:
            tokens_pos = clip.tokenize(current_text)
            pos_cond = clip.encode_from_tokens_scheduled(tokens_pos)
            
            neg_cond = []
            for t in pos_cond:
                d = t[1].copy() if len(t) > 1 else {}
                if "pooled_output" in d and d["pooled_output"] is not None:
                    d["pooled_output"] = torch.zeros_like(d["pooled_output"])
                neg_cond.append((torch.zeros_like(t[0]), d))
            
            if len(NeoPrompts._encode_cache) >= NeoPrompts._CACHE_MAX_SIZE:
                NeoPrompts._encode_cache.clear()
            NeoPrompts._encode_cache[cache_key] = (pos_cond, neg_cond)
        
        return {
            "ui": {"text": [current_text]},
            "result": (pos_cond, neg_cond, current_text)
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")


# ==========================================
# API Routes for Prompt Management
# ==========================================

@server.PromptServer.instance.routes.post("/rs_prompts/save_prompt")
async def rs_prompts_save_prompt(request):
    try:
        data = await request.json()
        name = data.get("name", "").strip()
        if not name: 
            return web.Response(status=400, text="Name required")
        name = "".join(c for c in name if c.isalnum() or c in " _-").strip()
        if not name: 
            return web.Response(status=400, text="Invalid name")
        
        # 默认保存到 custom 目录
        base_dir = CUSTOM_DIR
        # 如果名称中包含 "presets/" 前缀，则保存到 presets
        if name.startswith("presets/"):
            base_dir = PRESETS_DIR
            name = name[len("presets/"):]
        
        # 构建文件路径（支持子目录）
        filepath = os.path.join(base_dir, f"{name}.txt")
        counter = 1
        while os.path.exists(filepath):
            filepath = os.path.join(base_dir, f"{name}-{counter}.txt")
            counter += 1
        
        # 确保目录存在
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(data.get("text", ""))
        
        # 确定来源
        source = "presets" if base_dir == PRESETS_DIR else "custom"
        _update_tags_index(name, data.get("tags", []), source=source)
        
        return web.Response(status=200, text="OK")
    except Exception as e:
        logger.error(f"Error saving prompt: {e}")
        return web.Response(status=500, text=str(e))

@server.PromptServer.instance.routes.post("/rs_prompts/list_prompts")
async def rs_prompts_list_prompts(request):
    try:
        # 递归扫描 presets 和 custom 目录
        presets_prompts = _scan_prompts_recursive(PRESETS_DIR, source="presets")
        custom_prompts = _scan_prompts_recursive(CUSTOM_DIR, source="custom")
        
        # 按 mtime 倒序排序（每组内最新的在前）
        def sort_key(x):
            return -x.get("_mtime", 0)
        
        custom_prompts.sort(key=sort_key)
        presets_prompts.sort(key=sort_key)
        
        # custom 在前，presets 在后
        prompts = custom_prompts + presets_prompts
        
        return web.json_response(prompts)
    except Exception as e:
        logger.error(f"Error listing prompts: {e}")
        return web.Response(status=500, text=str(e))

@server.PromptServer.instance.routes.post("/rs_prompts/load_prompt")
async def rs_prompts_load_prompt(request):
    try:
        data = await request.json()
        name = data.get("name")
        if not name:
            return web.Response(status=400, text="Name required")
        
        # 根据名称中的路径判断来源目录
        if name.startswith("presets/"):
            base_dir = PRESETS_DIR
            name = name[len("presets/"):]
        else:
            base_dir = CUSTOM_DIR
        
        # 构建文件路径（支持子目录）
        filepath = os.path.join(base_dir, f"{name}.txt")
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                text_content = f.read()
                return web.json_response({"text": text_content})
        
        # 尝试在两个目录中查找
        for search_dir in [CUSTOM_DIR, PRESETS_DIR]:
            filepath = os.path.join(search_dir, f"{name}.txt")
            if os.path.exists(filepath):
                with open(filepath, 'r', encoding='utf-8') as f:
                    text_content = f.read()
                    return web.json_response({"text": text_content})
        
        return web.Response(status=404, text="Prompt not found")
    except Exception as e:
        logger.error(f"Error loading prompt: {e}")
        return web.Response(status=500, text=str(e))

@server.PromptServer.instance.routes.post("/rs_prompts/delete_prompt")
async def rs_prompts_delete_prompt(request):
    try:
        data = await request.json()
        name = data.get("name")
        if not name: 
            return web.Response(status=400, text="Name required")
        
        # 确定来源和基础目录
        if name.startswith("presets/"):
            base_dir = PRESETS_DIR
            name = name[len("presets/"):]
            source = "presets"
        else:
            base_dir = CUSTOM_DIR
            source = "custom"
        
        # 构建文件路径
        filepath = os.path.join(base_dir, f"{name}.txt")
        if os.path.exists(filepath):
            os.remove(filepath)
            _update_tags_index(name, tags=None, source=source)
            return web.Response(status=200, text="OK")
        
        # 尝试在两个目录中查找
        for search_dir in [CUSTOM_DIR, PRESETS_DIR]:
            filepath = os.path.join(search_dir, f"{name}.txt")
            if os.path.exists(filepath):
                os.remove(filepath)
                s = "custom" if search_dir == CUSTOM_DIR else "presets"
                _update_tags_index(name, tags=None, source=s)
                return web.Response(status=200, text="OK")
        
        return web.Response(status=404, text="Prompt not found")
    except Exception as e:
        logger.error(f"Error deleting prompt: {e}")
        return web.Response(status=500, text=str(e))

@server.PromptServer.instance.routes.get("/rs_prompts/get_models")
async def rs_prompts_get_models(request):
    try:
        models = get_available_models()
        return web.json_response(models)
    except Exception as e:
        logger.error(f"Error getting models: {e}")
        return web.Response(status=500, text=str(e))

@server.PromptServer.instance.routes.post("/rs_prompts/set_model")
async def rs_prompts_set_model(request):
    try:
        data = await request.json()
        model_key = data.get("model_key")
        if not model_key:
            return web.Response(status=400, text="model_key required")
        
        success = set_current_model(model_key)
        if success:
            return web.json_response({"success": True, "current_model": model_key})
        else:
            return web.Response(status=400, text="Invalid model key")
    except Exception as e:
        logger.error(f"Error setting model: {e}")
        return web.Response(status=500, text=str(e))


# ==========================================
# Remote LLM Configuration API Routes
# ==========================================

@server.PromptServer.instance.routes.get("/rs_prompts/remote_llm_config")
async def rs_prompts_get_remote_llm_config(request):
    """获取远程 LLM 配置"""
    try:
        config = get_remote_llm_config()
        # 返回时隐藏 api_key
        safe_config = config.copy()
        safe_config["api_key"] = "***" if safe_config.get("api_key") else ""
        return web.json_response(safe_config)
    except Exception as e:
        logger.error(f"Error getting remote LLM config: {e}")
        return web.Response(status=500, text=str(e))


@server.PromptServer.instance.routes.post("/rs_prompts/remote_llm_config")
async def rs_prompts_set_remote_llm_config(request):
    """设置远程 LLM 配置"""
    try:
        data = await request.json()
        config = get_remote_llm_config()
        
        # 更新配置
        if "enabled" in data:
            config["enabled"] = bool(data["enabled"])
        if "provider" in data:
            config["provider"] = data["provider"]
        if "api_key" in data and data["api_key"]:
            # 只有当提供新的 api_key 时才更新
            config["api_key"] = data["api_key"]
        if "base_url" in data:
            config["base_url"] = data["base_url"]
        if "model" in data:
            config["model"] = data["model"]
        if "max_tokens" in data:
            config["max_tokens"] = int(data["max_tokens"])
        if "temperature" in data:
            config["temperature"] = float(data["temperature"])
        if "timeout" in data:
            config["timeout"] = int(data["timeout"])
        
        set_remote_llm_config(config)
        
        # 返回成功，隐藏 api_key
        return web.json_response({
            "success": True, 
            "config": {k: v for k, v in config.items() if k != "api_key"}
        })
    except Exception as e:
        logger.error(f"Error setting remote LLM config: {e}")
        return web.Response(status=500, text=str(e))


@server.PromptServer.instance.routes.get("/rs_prompts/llm_mode")
async def rs_prompts_get_llm_mode(request):
    """获取当前 LLM 模式"""
    try:
        mode = get_current_mode()
        return web.json_response({"mode": mode})
    except Exception as e:
        logger.error(f"Error getting LLM mode: {e}")
        return web.Response(status=500, text=str(e))


# ==========================================
# API Routes Registration (LLM API)
# ==========================================

@server.PromptServer.instance.routes.post("/rs_prompts/extract_title")
async def rs_prompts_extract_title(request):
    return await handle_llm_api_request("extract_title", request)

@server.PromptServer.instance.routes.post("/rs_prompts/extract_classify")
async def rs_prompts_extract_classify(request):
    return await handle_llm_api_request("extract_classify", request)

@server.PromptServer.instance.routes.post("/rs_prompts/enhance_prompt")
async def rs_prompts_enhance_prompt(request):
    return await handle_llm_api_request("enhance_prompt", request)

@server.PromptServer.instance.routes.post("/rs_prompts/translate_prompt")
async def rs_prompts_translate_prompt(request):
    return await handle_llm_api_request("translate_prompt", request)

@server.PromptServer.instance.routes.post("/rs_prompts/smart_prompt")
async def rs_prompts_smart_prompt(request):
    """智能提示词 - LLM 直接判断用户意图并生成/改写"""
    from aiohttp import web
    try:
        data = await request.json()
        original_text = data.get("text", "")  # 原始提示词（可选）
        user_description = data.get("description", "")  # 用户描述
        
        logger.info(f"Smart prompt request: original='{original_text[:100]}...', description='{user_description[:100]}...'")
        
        if not user_description or not user_description.strip():
            return web.json_response({"error": "description is required"}, status=400)
        
        # 组合输入文本
        if original_text and original_text.strip():
            combined_text = f"{original_text}\n\n---\n\n{user_description}"
        else:
            combined_text = user_description
        
        from .llm import run_llm_task, get_current_mode, LLM_MODE_REMOTE
        result_data = run_llm_task("smart_prompt", combined_text)
        
        if "error" in result_data:
            error_msg = result_data["error"]
            logger.warning(f"Smart prompt error: {error_msg}")
            
            # 如果是本地模式且模型未加载，提供有用的提示
            if get_current_mode() == LLM_MODE_LOCAL and ("LLM model not found" in error_msg or "Model not loaded" in error_msg):
                return web.json_response({
                    "error": f"Local model is not available. Please download the model first, or switch to remote API mode."
                }, status=422)
            
            # 如果是远程模式且配置不正确，提供有用的提示
            if get_current_mode() == LLM_MODE_REMOTE:
                return web.json_response({
                    "error": f"Remote API error: {error_msg}. Please check your remote_llm_config.json configuration."
                }, status=422)
            
            return web.json_response({"error": error_msg}, status=422)
        
        logger.info(f"Smart prompt response: result='{result_data.get('prompt', '')[:100]}...'")
        return web.json_response(result_data)
        
    except Exception as e:
        logger.error(f"Error handling smart prompt: {e}")
        logger.exception(e)
        return web.json_response({"error": str(e)}, status=500)


@server.PromptServer.instance.routes.post("/rs_prompts/reverse_prompt")
async def rs_prompts_reverse_prompt(request):
    """从图像反推提示词，结果保存为同名 .txt 文件"""
    from aiohttp import web
    import base64
    from pathlib import Path
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "presets")
        
        if not filename:
            return web.json_response({"error": "filename is required"}, status=400)
        
        # 确定图像所在目录
        from .gallery import PRESETS_DIR, CUSTOM_DIR, _get_user_custom_dirs, IMG_EXTENSIONS
        base: Path | None = None
        
        if subfolder == "presets" or subfolder == "":
            base = PRESETS_DIR
        elif subfolder == "custom":
            base = CUSTOM_DIR
        else:
            user_custom_dirs = _get_user_custom_dirs()
            dir_parts = [p for p in subfolder.split("/") if p]
            if dir_parts[0] == "presets":
                base = PRESETS_DIR / "/".join(dir_parts[1:])
            else:
                for dir_path in user_custom_dirs:
                    d_name = dir_path.name if dir_path.name else str(dir_path)
                    if dir_parts[0] == d_name:
                        base = dir_path / "/".join(dir_parts[1:]) if len(dir_parts) > 1 else dir_path
                        break
        
        if base is None or not base.exists():
            return web.json_response({"error": "Directory not found"}, status=404)
        
        # 查找图像文件
        image_path: Path | None = None
        for ext in IMG_EXTENSIONS:
            candidate = base / f"{filename}{ext}"
            if candidate.exists():
                image_path = candidate
                break
        
        if image_path is None:
            # 尝试不带扩展名
            candidate = base / filename
            if candidate.exists():
                image_path = candidate
        
        if image_path is None:
            return web.json_response({"error": "Image not found"}, status=404)
        
        # 读取图像，如果过大则缩放到最长边 1024px
        MAX_REVERSE_SIDE = 1024
        image_bytes: bytes = b""
        try:
            from PIL import Image
            import io
            with Image.open(image_path) as img:
                w, h = img.size
                if max(w, h) > MAX_REVERSE_SIDE:
                    ratio = MAX_REVERSE_SIDE / max(w, h)
                    new_w = int(w * ratio)
                    new_h = int(h * ratio)
                    img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                    buf = io.BytesIO()
                    img_resized.save(buf, format=img.format or "PNG")
                    image_bytes = buf.getvalue()
                    logger.info(f"Reverse prompt: image={image_path.name}, resized {w}x{h} -> {new_w}x{new_h}")
                else:
                    with open(image_path, "rb") as f:
                        image_bytes = f.read()
                    logger.info(f"Reverse prompt: image={image_path.name}, size={len(image_bytes)} bytes")
        except Exception as resize_err:
            logger.warning(f"Failed to resize image, using original: {resize_err}")
            with open(image_path, "rb") as f:
                image_bytes = f.read()
        
        # 调用 LLM 反推
        result_data = run_llm_task("reverse_prompt", "", images=[image_bytes])
        
        if "error" in result_data:
            error_msg = result_data["error"]
            logger.warning(f"Reverse prompt error: {error_msg}")
            return web.json_response({"error": error_msg}, status=422)
        
        prompt_text = result_data.get("prompt", "")
        if not prompt_text:
            return web.json_response({"error": "Failed to generate prompt"}, status=500)
        
        # 保存为同名 .txt 文件
        txt_path = image_path.with_suffix(".txt")
        txt_path.write_text(prompt_text, encoding="utf-8")
        logger.info(f"Reverse prompt saved to: {txt_path}")
        
        return web.json_response({"status": "success", "prompt": prompt_text, "txt_file": txt_path.name})
        
    except Exception as e:
        logger.error(f"Error handling reverse prompt: {e}")
        logger.exception(e)
        return web.json_response({"error": str(e)}, status=500)


@server.PromptServer.instance.routes.post("/rs_prompts/random_prompt")
async def rs_prompts_random_prompt(request):
    """Random prompt - pick a random preset from the list."""
    try:
        import random
        # 获取 preset list
        presets_prompts = _scan_prompts_recursive(PRESETS_DIR, source="presets")
        custom_prompts = _scan_prompts_recursive(CUSTOM_DIR, source="custom")
        all_prompts = custom_prompts + presets_prompts
        
        if not all_prompts:
            return web.json_response({"status": "error", "prompt": "", "error": "No presets available"})
        
        # 随机选择一个
        selected = random.choice(all_prompts)
        name = selected["name"]
        
        # 直接读取文件
        if name.startswith("presets/"):
            base_dir = PRESETS_DIR
            name = name[len("presets/"):]
        else:
            base_dir = CUSTOM_DIR
        
        filepath = os.path.join(base_dir, f"{name}.txt")
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                text_content = f.read()
            return web.json_response({"status": "success", "prompt": text_content})
        
        return web.json_response({"status": "error", "prompt": "", "error": "Prompt not found"})
    except Exception as e:
        logger.error(f"Error in random prompt: {e}")
        return web.json_response({"status": "error", "prompt": "", "error": str(e)})

@server.PromptServer.instance.routes.get("/rs_prompts/check_model")
async def rs_prompts_check_model(request):
    """检查当前 LLM 模型是否已下载，不触发下载"""
    try:
        status = check_model_status()
        return web.json_response(status)
    except Exception as e:
        logger.error(f"Error checking model status: {e}")
        return web.json_response({
            "model_available": False,
            "mmproj_available": False,
            "error": str(e)
        }, status=500)

@server.PromptServer.instance.routes.get("/rs_prompts/check_all_models")
async def rs_prompts_check_all_models(request):
    """检查所有 LLM 模型的下载状态"""
    try:
        status = check_all_models_status()
        return web.json_response(status)
    except Exception as e:
        logger.error(f"Error checking all models status: {e}")
        return web.json_response({
            "models": [],
            "current_model": "",
            "error": str(e)
        }, status=500)

@server.PromptServer.instance.routes.post("/rs_prompts/download_model")
async def rs_prompts_download_model(request):
    """启动后台下载任务（非阻塞）"""
    try:
        data = await request.json()
        file_type = data.get("file_type", "model")
        
        if file_type not in ["model", "mmproj"]:
            return web.json_response({"error": "Invalid file type"}, status=400)
        
        result = start_download(file_type)
        return web.json_response(result)
    except Exception as e:
        logger.error(f"Error starting download: {e}")
        return web.json_response({"error": str(e)}, status=500)


# ==========================================
# NeoPromptGenerator Node Class
# A simple prompt generator node with settings button only
# ==========================================

class NeoPromptGenerator:
    """
    A simple prompt generator node that outputs text only.
    - No clip input required
    - No switch (external/internal input toggle)
    - Output: STRING (the prompt text)
    - Has a settings button to select LLM model
    """
    
    _CACHE_MAX_SIZE = 50
    MIN_SIZE = (400, 300)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": "",  "hidden": True}),
                "instance_uid": ("STRING", {"default": "", "hidden": True}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("PROMPT",)
    FUNCTION = "get_prompt"
    CATEGORY = "Neo-Nodes"
    OUTPUT_NODE = True
    DESCRIPTION = "Simple prompt generator node with settings button. No clip encoder binding."

    def get_prompt(self, prompt="", instance_uid="", unique_id=None):
        """Returns the prompt text as output."""
        return {
            "ui": {"text": [prompt]},
            "result": (prompt,)
        }

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")


# ==========================================
# Node Class Mappings
# ==========================================
NODE_CLASS_MAPPINGS = {
    "NeoPromptEncoder": NeoPrompts,
    "NeoPromptGenerator": NeoPromptGenerator,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NeoPromptEncoder": "Neo Prompt Encoder",
    "NeoPromptGenerator": "Neo Prompt Generator",
}
