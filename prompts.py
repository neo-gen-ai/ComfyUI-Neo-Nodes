# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes - Prompts

import os
import json
import server
import torch
from aiohttp import web
import threading
import logging
from server import PromptServer

logger = logging.getLogger(__name__)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROMPTS_DIR = os.path.join(CURRENT_DIR, "prompts")
TAGS_FILE = os.path.join(PROMPTS_DIR, "_tags_index.json")

if not os.path.exists(PROMPTS_DIR):
    os.makedirs(PROMPTS_DIR)

PENDING_PROMPTS = {}

_tags_lock = threading.Lock()

# 从 llm 模块导入 LLM 相关功能
from .llm import (
    handle_llm_api_request,
    check_model_status,
    start_download,
)


def _load_tags_index() -> dict:
    """Load tags index from the dedicated tags file."""
    if not os.path.exists(TAGS_FILE):
        return {}
    try:
        with open(TAGS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, Exception) as e:
        logger.warning(f"Error loading tags index: {e}")
        return {}


def _save_tags_index(index: dict) -> None:
    """Save tags index to the dedicated tags file."""
    try:
        with open(TAGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(index, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving tags index: {e}")


def _update_tags_index(prompt_name: str, tags: list[str] | None = None) -> None:
    """Update the tags index for a specific prompt. Pass tags=None to delete."""
    with _tags_lock:
        index = _load_tags_index()
        if tags is None:
            index.pop(prompt_name, None)
        else:
            index[prompt_name] = tags
        _save_tags_index(index)


def _get_tags_for_prompt(prompt_name: str) -> list:
    """Get tags for a prompt from the tags index."""
    index = _load_tags_index()
    return index.get(prompt_name, [])


# ==========================================
# Prompt Node Class
# ==========================================

class NeoPrompts:
    _encode_cache = {}
    _CACHE_MAX_SIZE = 50
    
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
        
        filepath = os.path.join(PROMPTS_DIR, f"{name}.json")
        counter = 1
        while os.path.exists(filepath):
            filepath = os.path.join(PROMPTS_DIR, f"{name}-{counter}.json")
            counter += 1
        
        prompt_data = {
            "text": data.get("text", "")
        }
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(prompt_data, f, indent=2, ensure_ascii=False)
        
        _update_tags_index(name, data.get("tags", []))
        
        return web.Response(status=200, text="OK")
    except Exception as e:
        logger.error(f"Error saving prompt: {e}")
        return web.Response(status=500, text=str(e))

@server.PromptServer.instance.routes.post("/rs_prompts/list_prompts")
async def rs_prompts_list_prompts(request):
    try:
        tags_index = _load_tags_index()
        
        prompts = []
        files_data = []
        if os.path.exists(PROMPTS_DIR):
            for f in os.listdir(PROMPTS_DIR):
                if f.endswith('.json') and not f.startswith('_'):
                    filepath = os.path.join(PROMPTS_DIR, f)
                    mtime = os.path.getmtime(filepath)
                    name = f[:-5]
                    
                    tags = tags_index.get(name, [])
                    
                    files_data.append({
                        "name": name,
                        "tags": tags,
                        "_mtime": mtime
                    })
            
            files_data.sort(key=lambda x: x["_mtime"], reverse=True)
            
            prompts = [{"name": p["name"], "tags": p["tags"]} for p in files_data]
        return web.json_response(prompts)
    except Exception as e:
        logger.error(f"Error listing prompts: {e}")
        return web.Response(status=500, text=str(e))

@server.PromptServer.instance.routes.post("/rs_prompts/load_prompt")
async def rs_prompts_load_prompt(request):
    try:
        data = await request.json()
        name = data.get("name")
        filepath = os.path.join(PROMPTS_DIR, f"{name}.json")
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                result = json.load(f)
                return web.json_response(result)
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
        filepath = os.path.join(PROMPTS_DIR, f"{name}.json")
        if os.path.exists(filepath):
            os.remove(filepath)
            _update_tags_index(name, tags=None)
            return web.Response(status=200, text="OK")
        return web.Response(status=404, text="Prompt not found")
    except Exception as e:
        logger.error(f"Error deleting prompt: {e}")
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

@server.PromptServer.instance.routes.post("/rs_prompts/generate_prompt")
async def rs_prompts_generate_prompt(request):
    return await handle_llm_api_request("generate_prompt", request)

@server.PromptServer.instance.routes.post("/rs_prompts/random_prompt")
async def rs_prompts_random_prompt(request):
    return await handle_llm_api_request("random_prompt", request)

@server.PromptServer.instance.routes.get("/rs_prompts/check_model")
async def rs_prompts_check_model(request):
    """检查 LLM 模型是否已下载，不触发下载"""
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
# Node Class Mappings
# ==========================================
NODE_CLASS_MAPPINGS = {
    "NeoPrompts": NeoPrompts,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NeoPrompts": "Neo Prompts",
}