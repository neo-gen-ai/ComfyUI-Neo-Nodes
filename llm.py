# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes - LLM (Large Language Model)
# LLM 公共代码模块，支持本地模型和远程 API

from __future__ import annotations

import os
import re
import json
import logging
import asyncio
import base64
import io
import hashlib
import socket
from typing import Any, Dict, List, Optional, Generator
from pathlib import Path
import folder_paths
from collections import OrderedDict

# ==========================================
# HuggingFace Endpoint Configuration
# ==========================================
# Allow override via environment variable, default to official HuggingFace endpoint
hf_endpoint = os.environ.get("HF_ENDPOINT", "https://huggingface.co")
os.environ["HF_ENDPOINT"] = hf_endpoint

# ==========================================
# LiteLLM Configuration
# ==========================================
# Use local model cost map to avoid network requests
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
# Use local tiktoken cache to avoid network requests
tiktoken_cache_dir = os.path.join(os.path.dirname(__file__), ".tiktoken_cache")
os.makedirs(tiktoken_cache_dir, exist_ok=True)
os.environ.setdefault("TIKTOKEN_CACHE_DIR", tiktoken_cache_dir)

logger = logging.getLogger(__name__)

# Pre-load tiktoken to avoid network requests (skip if network unavailable)
try:
    import tiktoken
    tiktoken.get_encoding("cl100k_base")
except Exception as e:
    logger.warning(f"Failed to pre-load tiktoken (network unavailable): {e}")

# ==========================================
# LLM Configuration & Management
# ==========================================

def _load_model_config():
    """从 model_config.json 加载用户模型配置"""
    config_path = os.path.join(_CONFIGS_DIR, "model_config.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        return config
    except Exception as e:
        logger.error(f"Failed to load model config: {e}")
        return {}

def _load_presets():
    """从 model_presets.json 加载预设模型"""
    presets_path = os.path.join(_CONFIGS_DIR, "model_presets.json")
    try:
        with open(presets_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load model presets: {e}")
        return {}

_CONFIGS_DIR = os.path.join(os.path.dirname(__file__), "configs")

_MODEL_CONFIG: Dict[str, Any] = _load_model_config()
_MODEL_PRESETS: Dict[str, Any] = _load_presets()

def get_model_config():
    """获取模型配置"""
    if not _MODEL_CONFIG:
        return {
            "model": {
                "ms_repo_id": "unsloth/Qwen3.5-0.8B-GGUF",
                "hf_repo_id": "unsloth/Qwen3.5-0.8B-GGUF",
                "filename": "Qwen3.5-0.8B-UD-Q4_K_XL.gguf"
            },
            "mmproj": {
                "filename": "mmproj-BF16.gguf"
            }
        }
    return _MODEL_CONFIG


# ==========================================
# Text Normalization Utility
# ==========================================

def _normalize_text(text):
    """标准化文本，用于缓存键的生成"""
    if not text:
        return ""
    text = text.strip()
    text = re.sub(r'\s+', ' ', text)
    return text


# ==========================================
# Translation Cache Configuration
# ==========================================

class TranslationCache:
    """翻译缓存，支持双向缓存和自动淘汰"""
    
    _KEY_TEXT = "T:"
    _KEY_RESULT = "R:"
    
    def __init__(self, max_size=200):
        self._store = OrderedDict()
        self.max_size = max_size
    
    def get(self, text):
        normalized = _normalize_text(text)
        result = self._store.get(f"{self._KEY_TEXT}{normalized}")
        if result:
            return result
        return self._store.get(f"{self._KEY_RESULT}{normalized}")
    
    def set(self, text, result):
        normalized_text = _normalize_text(text)
        normalized_result = _normalize_text(result)
        
        text_key = f"{self._KEY_TEXT}{normalized_text}"
        result_key = f"{self._KEY_RESULT}{normalized_result}"
        
        if text_key in self._store:
            del self._store[text_key]
        if result_key in self._store:
            del self._store[result_key]
        
        self._store[text_key] = normalized_result
        self._store[result_key] = normalized_text
        
        while len(self._store) > self.max_size:
            self._evict_oldest()
    
    def _evict_oldest(self):
        if not self._store:
            return
        oldest_key = next(iter(self._store))
        self._store.pop(oldest_key)
        logger.info(f"Cache full, evicted oldest entry: '{oldest_key[:20]}...'")
    
    def size(self):
        return len(self._store)
    
    def clear(self):
        self._store.clear()


# 全局翻译缓存实例
TRANSLATION_CACHE = TranslationCache(max_size=200)


# ==========================================
# Remote LLM Configuration
# ==========================================

_REMOTE_CONFIG_PATH = os.path.join(_CONFIGS_DIR, "remote_llm_config.json")

def _load_remote_config() -> Dict[str, Any]:
    """加载远程 LLM 配置"""
    try:
        if os.path.exists(_REMOTE_CONFIG_PATH):
            with open(_REMOTE_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load remote LLM config: {e}")
    return {
        "enabled": False,
        "provider": "openai",
        "api_key": "",
        "base_url": "",
        "model": "gpt-4o-mini",
        "max_tokens": 500,
        "temperature": 0.0,
        "timeout": 60
    }

def _save_remote_config(config: Dict[str, Any]):
    """保存远程 LLM 配置"""
    try:
        with open(_REMOTE_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        logger.info("Remote LLM config saved")
    except Exception as e:
        logger.error(f"Failed to save remote LLM config: {e}")

def get_remote_llm_config() -> Dict[str, Any]:
    """获取远程 LLM 配置"""
    return _load_remote_config()

def set_remote_llm_config(config: Dict[str, Any]):
    """设置远程 LLM 配置"""
    _save_remote_config(config)

# 远程 LLM 模式常量
LLM_MODE_LOCAL = "local"
LLM_MODE_REMOTE = "remote"

def get_current_mode() -> str:
    """获取当前 LLM 模式：local 或 remote"""
    config = _load_remote_config()
    if config.get("enabled", False):
        return LLM_MODE_REMOTE
    return LLM_MODE_LOCAL


# ==========================================
# Model-Specific System Prompts (for remote mode)
# ==========================================

_TASK_MODEL_CONFIGS = {
    "extract_title": {"max_tokens": 20, "model_override": None},
    "extract_classify": {"max_tokens": 50, "model_override": None},
    "enhance_prompt": {"max_tokens": 500, "model_override": None},
    "translate_prompt": {"max_tokens": 500, "model_override": None},
}

def get_task_config(task_name: str) -> Dict[str, Any]:
    """获取任务配置"""
    return _TASK_MODEL_CONFIGS.get(task_name, {"max_tokens": 500, "model_override": None})


# ==========================================
# Model Config Helpers (presets + user config)
# ==========================================

def _get_all_models() -> Dict[str, Any]:
    """合并预设模型和用户自定义模型（用户模型覆盖预设）"""
    return {**_MODEL_PRESETS, **_MODEL_CONFIG.get("models", {})}


def _get_current_model_cfg() -> Dict[str, Any]:
    """获取当前模型的配置"""
    all_models = _get_all_models()
    current_key = _MODEL_CONFIG.get("current_model", "") or "Qwen-0.8B/Qwen3.5-0.8B-UD-Q4_K_XL"
    if current_key in all_models:
        return all_models[current_key]
    first_key = list(all_models.keys())[0] if all_models else ""
    return all_models.get(first_key, {})


def scan_llm_directory() -> List[Dict[str, str]]:
    """扫描 models/LLM/ 目录，发现所有 .gguf 文件，并自动补充到 model_config.json"""
    base_dir = folder_paths.base_path
    llm_dir = os.path.join(base_dir, "models", "LLM")
    discovered: List[Dict[str, str]] = []
    seen: set = set()

    if not os.path.isdir(llm_dir):
        return discovered

    for entry in sorted(os.listdir(llm_dir)):
        subdir = os.path.join(llm_dir, entry)
        if not os.path.isdir(subdir):
            continue
        for fname in sorted(os.listdir(subdir)):
            if fname.lower().endswith(".gguf"):
                key = f"{entry}/{fname.replace('.gguf', '')}"
                if key in seen:
                    continue
                seen.add(key)
                discovered.append({
                    "key": key,
                    "name": key,
                    "filename": fname,
                    "model_dir": entry,
                })
                _ensure_model_in_config(key, entry, fname)
    return discovered


def _ensure_model_in_config(model_key: str, model_dir: str, filename: str) -> None:
    """将扫描发现的模型自动写入 model_config.json（如果尚未存在）"""
    global _MODEL_CONFIG
    models: Dict[str, Any] = _MODEL_CONFIG.get("models", {})
    if model_key not in models:
        models[model_key] = {
            "ms_repo_id": "",
            "hf_repo_id": "",
            "filename": filename,
            "model_dir": model_dir,
        }
        _save_model_config()
        logger.info(f"Auto-added model to config: {model_key}")


def __reload_llm_singleton():
    """销毁并重建 LLM 单例，以加载新模型"""
    global LLMSingleton
    LLMSingleton._instance = None


def set_current_model(model_key: str) -> bool:
    """设置当前模型（支持预设模型和用户自定义模型）"""
    global _MODEL_CONFIG
    all_models = _get_all_models()

    if model_key not in all_models:
        parts = model_key.split("/", 1)
        if len(parts) == 2:
            model_dir, filename = parts
            _ensure_model_in_config(model_key, model_dir, filename)
            _MODEL_CONFIG = _read_model_config_from_file() or _MODEL_CONFIG
            all_models = _get_all_models()

    if model_key in all_models:
        _MODEL_CONFIG["current_model"] = model_key
        _save_model_config()
        __reload_llm_singleton()
        return True
    return False


def _save_model_config():
    """保存用户模型配置到文件"""
    config_path = os.path.join(_CONFIGS_DIR, "model_config.json")
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(_MODEL_CONFIG, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to save model config: {e}")


def _read_model_config_from_file():
    """从文件重新读取用户模型配置（用于运行时动态获取最新配置）"""
    config_path = os.path.join(_CONFIGS_DIR, "model_config.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read model config from file: {e}")
        return {}


def get_available_models() -> Dict[str, Any]:
    """获取所有可用模型列表（合并预设 + 用户自定义 + 目录扫描）"""
    global _MODEL_CONFIG
    config = _read_model_config_from_file()
    if config:
        _MODEL_CONFIG.clear()
        _MODEL_CONFIG.update(config)

    all_models = _get_all_models()
    model_list: List[Dict[str, str]] = []
    seen_keys: set = set()

    for key, cfg in all_models.items():
        cfg_dict: Dict[str, str] = cfg
        model_list.append({
            "key": key,
            "name": key,
            "filename": cfg_dict.get("filename", ""),
            "model_dir": cfg_dict.get("model_dir", ""),
        })
        seen_keys.add(key)

    scanned = scan_llm_directory()
    for item in scanned:
        if item["key"] not in seen_keys:
            model_list.append({
                "key": item["key"],
                "name": item["name"],
                "filename": item["filename"],
                "model_dir": item["model_dir"],
            })
            seen_keys.add(item["key"])

    return {
        "current_model": _MODEL_CONFIG.get("current_model", "Qwen-0.8B/Qwen3.5-0.8B-UD-Q4_K_XL"),
        "models": model_list,
    }


# ==========================================
# Download Status Management (for local mode)
# ==========================================

import threading

_download_status = {
    "model": {"downloading": False, "progress": 0, "error": None},
    "mmproj": {"downloading": False, "progress": 0, "error": None}
}
_download_lock = threading.Lock()

def get_model_paths():
    """获取模型文件路径 - 每次都从文件读取最新配置"""
    config = _read_model_config_from_file()
    if not config:
        config = _MODEL_CONFIG

    all_models = _get_all_models()
    current_model_key: str = config.get("current_model", "") or "Qwen-0.8B/Qwen3.5-0.8B-UD-Q4_K_XL"

    model_cfg = all_models.get(current_model_key, {})

    MODEL_FILENAME = model_cfg.get("filename", "")
    MODEL_DIR = model_cfg.get("model_dir", "Qwen-0.8B")

    base_dir = folder_paths.base_path
    model_dir = os.path.join(base_dir, "models", "LLM", MODEL_DIR)
    target_path = os.path.join(model_dir, MODEL_FILENAME)

    MMPROJ_FILENAME = config.get("mmproj", {}).get("filename", "mmproj-BF16.gguf")
    mmproj_path = os.path.join(model_dir, MMPROJ_FILENAME)
    return target_path, mmproj_path

def check_model_status():
    """检查模型文件是否存在，返回状态信息"""
    target_path, mmproj_path = get_model_paths()

    model_exists = os.path.exists(target_path)
    mmproj_exists = os.path.exists(mmproj_path)

    config = _read_model_config_from_file()
    if not config:
        config = _MODEL_CONFIG

    all_models = _get_all_models()
    current_model_key: str = config.get("current_model", "") or "Qwen-0.8B/Qwen3.5-0.8B-UD-Q4_K_XL"
    model_cfg = all_models.get(current_model_key, {})

    MS_REPO_ID = model_cfg.get("ms_repo_id", "")
    HF_REPO_ID = model_cfg.get("hf_repo_id", "")
    MODEL_FILENAME = model_cfg.get("filename", "")
    MMPROJ_FILENAME = config.get("mmproj", {}).get("filename", "mmproj-BF16.gguf")

    if _download_status["model"]["downloading"]:
        logger.info(f"Download status check: downloading={_download_status['model']['downloading']}, "
                    f"progress={_download_status['model']['progress']}%, "
                    f"model_exists={model_exists}, target_path={target_path}")

    return {
        "model_available": model_exists,
        "mmproj_available": mmproj_exists,
        "model_filename": MODEL_FILENAME,
        "mmproj_filename": MMPROJ_FILENAME,
        "model_repo_id": MS_REPO_ID,
        "hf_repo_id": HF_REPO_ID,
        "model_path": target_path if model_exists else None,
        "mmproj_path": mmproj_path if mmproj_exists else None,
        "download_status": _download_status
    }

def check_all_models_status():
    """检查所有模型文件的状态（合并预设 + 用户自定义 + 目录扫描）"""
    base_dir = folder_paths.base_path
    all_models = _get_all_models()

    models_status: List[Dict[str, Any]] = []
    seen_keys: set = set()

    for key, config in all_models.items():
        config_dict: Dict[str, Any] = config
        model_dir: str = config_dict.get("model_dir", "")
        filename: str = config_dict.get("filename", "")

        model_path = os.path.join(base_dir, "models", "LLM", model_dir, filename)
        exists = os.path.exists(model_path)

        models_status.append({
            "key": key,
            "name": key,
            "filename": filename,
            "model_dir": model_dir,
            "available": exists
        })
        seen_keys.add(key)

    # 补充扫描目录中发现但尚未在配置中的模型
    scanned = scan_llm_directory()
    for item in scanned:
        if item["key"] not in seen_keys:
            model_path = os.path.join(base_dir, "models", "LLM", item["model_dir"], item["filename"])
            models_status.append({
                "key": item["key"],
                "name": item["name"],
                "filename": item["filename"],
                "model_dir": item["model_dir"],
                "available": os.path.exists(model_path)
            })
            seen_keys.add(item["key"])

    return {
        "models": models_status,
        "current_model": _MODEL_CONFIG.get("current_model", "Qwen-0.8B/Qwen3.5-0.8B-UD-Q4_K_XL")
    }

def start_download(file_type):
    """启动后台下载任务（非阻塞）"""
    if file_type not in ["model", "mmproj"]:
        return {"error": "Invalid file type"}

    target_path, _ = get_model_paths()
    if file_type == "model" and os.path.exists(target_path):
        return {"status": "already_exists"}

    _, mmproj_path = get_model_paths()
    if file_type == "mmproj" and os.path.exists(mmproj_path):
        return {"status": "already_exists"}

    thread = threading.Thread(target=_download_file_background, args=(file_type,), daemon=True)
    thread.start()

    return {"status": "started", "file_type": file_type}

def _download_file_background(file_type):
    """后台下载文件（在独立线程中运行）"""
    global _download_status

    with _download_lock:
        if _download_status[file_type]["downloading"]:
            logger.warning(f"Download already in progress for {file_type}")
            return False

        _download_status[file_type]["downloading"] = True
        _download_status[file_type]["progress"] = 0
        _download_status[file_type]["error"] = None

    try:
        base_dir = folder_paths.base_path

        if file_type == "model":
            all_models = _get_all_models()
            config = _read_model_config_from_file()
            if not config:
                config = _MODEL_CONFIG
            current_model_key: str = config.get("current_model", "") or "Qwen-0.8B/Qwen3.5-0.8B-UD-Q4_K_XL"
            model_cfg = all_models.get(current_model_key, {})
            filename = model_cfg.get("filename", "")
            MODEL_DIR = model_cfg.get("model_dir", "Qwen-0.8B")
            MS_REPO_ID = model_cfg.get("ms_repo_id", "")
            HF_REPO_ID = model_cfg.get("hf_repo_id", "")
        else:
            filename = _MODEL_CONFIG.get("mmproj", {}).get("filename", "")
            all_models = _get_all_models()
            current_model_key = _MODEL_CONFIG.get("current_model", "") or "Qwen-0.8B/Qwen3.5-0.8B-UD-Q4_K_XL"
            model_cfg = all_models.get(current_model_key, {})
            MODEL_DIR = model_cfg.get("model_dir", "Qwen-0.8B")
            MS_REPO_ID = ""
            HF_REPO_ID = ""

        model_dir = os.path.join(base_dir, "models", "LLM", MODEL_DIR)
        os.makedirs(model_dir, exist_ok=True)

        target_path = os.path.join(model_dir, filename)

        if os.path.exists(target_path):
            _download_status[file_type]["downloading"] = False
            _download_status[file_type]["progress"] = 100
            logger.info(f"File already exists: {target_path}")
            return True

        success = _download_from_modelscope(model_dir, filename, file_type, MS_REPO_ID)
        if not success:
            logger.info("ModelScope download failed, trying HuggingFace...")
            success = _download_from_huggingface(model_dir, filename, file_type, HF_REPO_ID)

        if success:
            _download_status[file_type]["progress"] = 100
            _download_status[file_type]["downloading"] = False
            logger.info(f"Download complete: {target_path}")
            return True
        else:
            _download_status[file_type]["error"] = "Both ModelScope and HuggingFace downloads failed"
            _download_status[file_type]["downloading"] = False
            logger.error("All download attempts failed")
            return False
    except Exception as e:
        _download_status[file_type]["error"] = str(e)
        _download_status[file_type]["downloading"] = False
        logger.error(f"Download failed: {e}")
        return False

def _download_from_modelscope(model_dir, filename, file_type, ms_repo_id):
    """从 ModelScope 下载模型"""
    try:
        if not ms_repo_id:
            return False
        logger.info(f"Attempting download from ModelScope...")
        from modelscope import snapshot_download

        target_path = os.path.join(model_dir, filename)

        download_path = snapshot_download(
            ms_repo_id,
            allow_patterns=[filename],
            local_dir=model_dir,
            revision='master',
        )

        if os.path.exists(target_path):
            _download_status[file_type]["progress"] = 100
            logger.info(f"Downloaded from ModelScope: {target_path}")
            return True
        else:
            logger.warning("ModelScope download did not create expected file")
            return False
    except ImportError:
        logger.warning("modelscope not installed, trying HuggingFace...")
        return False
    except Exception as e:
        logger.error(f"ModelScope download failed: {e}")
        return False

def _download_from_huggingface(model_dir, filename, file_type, hf_repo_id):
    """从 HuggingFace 下载模型"""
    try:
        if not hf_repo_id:
            return False
        logger.info(f"Attempting download from HuggingFace...")
        from huggingface_hub import hf_hub_download

        target_path = os.path.join(model_dir, filename)

        downloaded_path = hf_hub_download(
            repo_id=hf_repo_id,
            filename=filename,
            local_dir=model_dir,
            force_download=False,
        )

        _download_status[file_type]["progress"] = 100
        logger.info(f"Downloaded from HuggingFace: {downloaded_path}")
        return True
    except Exception as e:
        logger.error(f"HuggingFace download failed: {e}")
        return False


# ==========================================
# Remote API LLM Client (requests)
# ==========================================

class RemoteLLMClient:
    """基于 requests 的远程 LLM 客户端，直接调用 OpenAI 兼容 API"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.provider = config.get("provider", "openai")
        self.api_key = config.get("api_key", "")
        self.base_url = config.get("base_url", "")
        self.model = config.get("model", "gpt-4o-mini")
        self.max_tokens = config.get("max_tokens", 500)
        self.temperature = config.get("temperature", 0.0)
        self.timeout = config.get("timeout", 60)

    def _add_images_to_messages(self, messages: List[Dict[str, Any]],
                                 image_bytes_list: List[bytes]) -> List[Dict[str, Any]]:
        """将图片添加到 user message 中"""
        result = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if image_bytes_list and isinstance(content, str) and role == "user":
                content_parts = []
                for img_bytes in image_bytes_list:
                    b64 = base64.b64encode(img_bytes).decode('utf-8')
                    content_parts.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"}
                    })
                content_parts.append({"type": "text", "text": content})
                content = content_parts

            result.append({"role": role, "content": content})
        return result

    def chat_completion(self, messages: List[Dict[str, Any]],
                        max_tokens: Optional[int] = None,
                        image_bytes_list: Optional[List[bytes]] = None,
                        stream: bool = False) -> Any:
        """
        发送聊天补全请求

        Args:
            messages: 消息列表
            max_tokens: 最大 token 数
            image_bytes_list: 图片字节列表
            stream: 是否流式输出

        Returns:
            非流式：返回响应字典；流式：返回生成器
        """
        import requests

        effective_max_tokens = max_tokens or self.max_tokens

        # 处理图片
        if image_bytes_list:
            messages = self._add_images_to_messages(messages, image_bytes_list)

        # 构建请求 URL
        if self.base_url:
            url = f"{self.base_url.rstrip('/')}/chat/completions"
        else:
            url = "https://api.openai.com/v1/chat/completions"

        # 构建请求头
        headers = {
            "Content-Type": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        # 构建请求体
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": effective_max_tokens,
            "temperature": self.temperature,
            "stream": stream,
        }

        logger.info(f"Sending request to remote LLM: url={url}, stream={stream}")

        try:
            if stream:
                return self._stream_response_generator(url, headers, payload)
            else:
                response = requests.post(url, headers=headers, json=payload, timeout=self.timeout)
                response.raise_for_status()
                return self._parse_response(response.json())
        except requests.exceptions.ConnectionError as e:
            logger.warning(f"Remote LLM connection error: {e}")
            raise RuntimeError(f"Remote LLM network error: {e}")
        except requests.exceptions.Timeout as e:
            logger.warning(f"Remote LLM timeout: {e}")
            raise RuntimeError(f"Remote LLM timeout: {e}")
        except requests.exceptions.HTTPError as e:
            logger.error(f"Remote LLM HTTP error: {e}")
            raise RuntimeError(f"Remote LLM HTTP error: {e}")
        except Exception as e:
            logger.error(f"Remote LLM completion failed: {e}")
            raise

    def _parse_response(self, response_data: Dict[str, Any]) -> Dict[str, Any]:
        """解析响应为统一格式"""
        choices = response_data.get("choices", [])
        if not choices:
            return {"choices": []}
        
        message = choices[0].get("message", {})
        content = message.get("content", "")
        return {
            "choices": [{
                "message": {"role": message.get("role", "assistant"), "content": content}
            }]
        }

    def _stream_response_generator(self, url: str, headers: Dict[str, str], payload: Dict[str, Any]):
        """流式响应生成器"""
        import requests

        with requests.post(url, headers=headers, json=payload, stream=True, timeout=self.timeout) as response:
            response.raise_for_status()
            full_content = []
            for line in response.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    if line.startswith('data: '):
                        data = line[6:]
                        if data == '[DONE]':
                            break
                        try:
                            chunk = json.loads(data)
                            choices = chunk.get("choices", [])
                            if choices:
                                delta = choices[0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    full_content.append(content)
                                    yield content
                        except json.JSONDecodeError:
                            pass
        return "".join(full_content)

    def is_available(self) -> bool:
        """检查客户端是否可用"""
        if not self.provider:
            return False
        # 本地提供商（ollama, lmstudio, llamacpp, vllm）不需要 API key
        local_providers = {"ollama", "lmstudio", "llamacpp", "vllm"}
        if self.provider not in local_providers and not self.api_key:
            return False
        return True


# ==========================================
# LLM Singleton (Local Mode)
# ==========================================

class LLMSingleton:
    """LLM 单例模式，确保模型只加载一次（本地模式）"""
    _instance = None
    _lock = threading.Lock()

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.model = None
        self.has_mmproj = False
        self._load_model()

    def _load_model(self):
        """加载 LLM 模型，如果不存在则报错"""
        target_path, mmproj_path = get_model_paths()

        model_dir = os.path.dirname(target_path)
        os.makedirs(model_dir, exist_ok=True)

        logger.info(f"Loading LLM model: {target_path}")
        logger.info(f"mmproj path: {mmproj_path}")

        if not os.path.exists(target_path):
            config = _read_model_config_from_file()
            if not config:
                config = _MODEL_CONFIG

            all_models = _get_all_models()
            current_model_key: str = config.get("current_model", "") or "Qwen-0.8B/Qwen3.5-0.8B-UD-Q4_K_XL"
            model_cfg = all_models.get(current_model_key, {})

            MODEL_FILENAME = model_cfg.get("filename", "unknown.gguf")
            raise RuntimeError(
                f"LLM model not found: {MODEL_FILENAME}\n"
                f"Expected path: {target_path}\n"
                f"Please download the model and place it in: {model_dir}/\n"
                f"Or switch to remote API mode in the node settings."
            )

        if not os.path.exists(mmproj_path):
            MMPROJ_FILENAME = _MODEL_CONFIG.get("mmproj", {}).get("filename", "")
            logger.warning(
                f"mmproj file not found: {mmproj_path}. "
                f"Image understanding will not work."
            )
            mmproj_path = None

        from llama_cpp import Llama

        logger.info(f"Initializing Llama with n_ctx=2048, n_threads=4, n_gpu_layers=-1")
        llama_kwargs = {
            "model_path": target_path,
            "n_ctx": 2048,
            "n_threads": 4,
            "n_gpu_layers": -1,
            "verbose": False,
        }

        if mmproj_path:
            logger.info(f"Loading mmproj file: {mmproj_path}")
            llama_kwargs["mmproj"] = mmproj_path
            self.mmproj_path = mmproj_path
        else:
            logger.warning("No mmproj file found, loading text-only model.")

        self.model = Llama(**llama_kwargs)
        self.has_mmproj = mmproj_path is not None
        logger.info(f"LLM model loaded successfully, has_mmproj={self.has_mmproj}")

    def create_chat_completion(self, messages, max_tokens, image_bytes_list=None, stream=False):
        """创建聊天补全请求，支持图像输入和流式输出"""
        if self.model is None:
            raise RuntimeError("LLM Model not loaded")

        if image_bytes_list and len(image_bytes_list) > 0:
            new_messages = []
            for msg in messages:
                if msg.get("role") == "user":
                    content_list = []
                    for img_bytes in image_bytes_list:
                        if isinstance(img_bytes, (bytes, bytearray)):
                            b64 = base64.b64encode(img_bytes).decode('utf-8')
                            data_uri = f"data:image/png;base64,{b64}"
                        elif isinstance(img_bytes, str):
                            data_uri = img_bytes
                        else:
                            continue
                        content_list.append({"type": "image_url", "image_url": {"url": data_uri}})
                    content_list.append({"type": "text", "text": msg.get("content", "")})
                    new_messages.append({"role": "user", "content": content_list})
                else:
                    new_messages.append(msg)
            messages = new_messages

        return self.model.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            stream=stream,
        )


def get_llm_instance():
    """获取 LLM 单例实例（本地模式）"""
    return LLMSingleton.get_instance()


# ==========================================
# Unified LLM Inference Engine
# ==========================================

def _run_llm_inference(system_prompt: str, user_text: str, max_tokens: int,
                       images: Optional[Any] = None, use_remote: bool = False,
                       stream: bool = False):
    """
    执行 LLM 推理，支持本地和远程模式

    Args:
        system_prompt: 系统提示词
        user_text: 用户文本
        max_tokens: 最大 token 数
        images: PIL Image 对象列表或字节数据列表（仅本地模式支持）
        use_remote: 是否使用远程 API
        stream: 是否流式输出

    Returns:
        非流式：LLM 响应文本；流式：返回生成器
    """
    if use_remote:
        result = _run_remote_inference(system_prompt, user_text, max_tokens, images, stream=stream)
        if result is not None:
            return result
        logger.warning("Remote LLM failed, falling back to local mode")
        return _run_local_inference(system_prompt, user_text, max_tokens, images, stream=stream)
    else:
        return _run_local_inference(system_prompt, user_text, max_tokens, images, stream=stream)


def _run_local_inference(system_prompt: str, user_text: str, max_tokens: int,
                         images: Optional[Any] = None, stream: bool = False):
    """执行本地 LLM 推理"""
    llm = get_llm_instance()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text}
    ]

    try:
        image_bytes_list = None
        if images is not None and len(images) > 0:
            image_bytes_list = []
            for img in images:
                if hasattr(img, 'tobytes'):
                    buffer = io.BytesIO()
                    img.save(buffer, format='PNG')
                    image_bytes_list.append(buffer.getvalue())
                elif isinstance(img, (bytes, bytearray)):
                    image_bytes_list.append(img)
                elif hasattr(img, 'read'):
                    image_bytes_list.append(img.read())

        output = llm.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            image_bytes_list=image_bytes_list,
            stream=stream,
        )

        if stream:
            return output  # 返回生成器

        if not isinstance(output, dict):
            logger.warning(f"LLM returned non-dict output: {type(output)}")
            return None

        choices = output.get('choices')
        if not isinstance(choices, list) or len(choices) == 0:
            logger.warning("LLM response 'choices' is empty or invalid.")
            return None

        message = choices[0].get('message', {})
        content = message.get('content', '')

        if not content:
            logger.warning("LLM 'content' is None.")
            return ""

        return content.strip()
    except Exception as e:
        logger.exception(f"Error during local LLM inference: {e}")
        return None


def _run_remote_inference(system_prompt: str, user_text: str, max_tokens: int,
                          images: Optional[Any] = None, stream: bool = False):
    """执行远程 LLM 推理"""
    config = _load_remote_config()

    if not config.get("enabled", False):
        raise RuntimeError("Remote LLM is not enabled. Please configure remote_llm_config.json")

    client = RemoteLLMClient(config)

    if not client.is_available():
        raise RuntimeError("Remote LLM client is not available (missing API key or provider)")

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text}
    ]

    try:
        image_bytes_list = None
        if images is not None and len(images) > 0:
            image_bytes_list = []
            for img in images:
                if hasattr(img, 'tobytes'):
                    buffer = io.BytesIO()
                    img.save(buffer, format='PNG')
                    image_bytes_list.append(buffer.getvalue())
                elif isinstance(img, (bytes, bytearray)):
                    image_bytes_list.append(img)
                elif hasattr(img, 'read'):
                    image_bytes_list.append(img.read())

        logger.info(f"Sending request to remote LLM: provider={client.provider}, model={client.model}")
        response = client.chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            image_bytes_list=image_bytes_list,
            stream=stream,
        )

        if stream:
            return response  # 返回生成器

        logger.info(f"Remote LLM response received")
        choices = response.get("choices", [])
        if not choices:
            logger.warning("Remote LLM response 'choices' is empty.")
            return ""

        message = choices[0].get("message", {})
        content = message.get("content", "")

        return content.strip() if content else ""
    except (RuntimeError, OSError, socket.gaierror) as e:
        # 网络相关错误已在上层捕获，直接返回
        logger.warning(f"Remote LLM inference failed (network): {e}")
        return None
    except Exception as e:
        logger.exception(f"Error during remote LLM inference: {e}")
        return None


# ==========================================
# Language Detection Utility
# ==========================================

def _detect_language(text):
    """检测文本语言"""
    if not text:
        return 'English'

    total_chars = len(text)
    if total_chars == 0:
        return 'English'

    chinese_chars = sum(1 for char in text if '\u4e00' <= char <= '\u9fff')
    chinese_percentage = (chinese_chars / total_chars) * 100

    if chinese_percentage >= 50:
        return 'Chinese'
    return 'English'


# ==========================================
# LLM Task Definitions
# ==========================================

LLM_TASKS = {
    "extract_title": {
        "system": (
            "你是一个专业的提示词标题提取助手。"
            "请从给定的文生图提示词中提取一个简洁的标题，小于 20 字，"
            "包含主体信息与主要场景,忽略风格词、参数和修饰语。"
            "只返回标题内容，不要包含任何解释或标点符号。"
        ),
        "max_tokens": 20,
        "result_key": "title",
        "description": "提取提示词标题"
    },
    "extract_classify": {
        "system": (
            "你是一个专业的提示词分类助手。"
            "请分析给定的文生图提示词，从以下列表中选择最适合的 1 个分类："
            "'唯美', '特色', '写实', '古风', '动漫', '油画', '室内', '户外'。"
            "仅返回这 1 个分类名称"
            "不要包含任何解释、标点符号或其他文字。"
        ),
        "max_tokens": 50,
        "result_key": "classify",
        "description": "提取提示词分类"
    },
    "enhance_prompt": {
        "system": (
            "你是一个专业的提示词增强助手。"
            "请分析给定的文生图提示词，将其扩展为更详细、更丰富的版本。"
            "要求：1.保留原始核心内容；2.添加细节描述（光影、材质、氛围等）；"
            "3.添加质量词（如：masterpiece, best quality, high resolution 等）；"
            "4.语言跟原文语言保存一致，适合文生图模型使用。"
            "仅返回增强后的提示词内容，不要包含任何解释或额外文字。"
        ),
        "max_tokens": 500,
        "result_key": "enhanced",
        "description": "增强提示词"
    },
    "translate_prompt": {
        "system": (
            "你是一个专业的提示词翻译助手。"
            "请将给定的提示词翻译成目标语言。"
            "要求：1.保留核心主体和关键词；2.保持简洁，适合文生图模型；"
            "3.不要包含任何解释、标点符号或额外文字。"
        ),
        "max_tokens": 500,
        "result_key": "translated",
        "description": "翻译提示词"
    },
    "smart_prompt": {
        "system": (
            "你是一个智能文生图提示词助手。用户会输入一段描述，你需要判断用户的意图并执行相应的操作。\n\n"
            "可能的意图包括：\n"
            "1. 【改写】用户想基于现有提示词进行修改（如：删除、添加、替换风格、调整细节等）\n"
            "2. 【生成】用户想从头生成一个新的提示词\n"
            "3. 【增强】用户想增强/优化现有提示词\n"
            "4. 【翻译】用户想翻译提示词\n\n"
            "判断规则：\n"
            "- 如果输入包含改写相关词汇（如：删除、添加、替换、修改、风格、改成、去掉、加上等），对原来的提示词执行改写，需要改写内容，不是直接拼接内容\n"
            "- 如果输入是简洁的描述，直接生成\n"
            "- 如果输入是纯描述性文字且没有明确操作指令，执行生成\n\n"
            "【重要】只返回最终的提示词内容，不要返回思考过程内容，不要包含任何解释、说明、前言或后缀文字。\n"
            "不要说'好的'、'这是改写后的提示词'等任何多余内容。直接输出提示词本身。\n\n"
            "用户指令格式：[原始提示词（如果有）]\n\n---\n\n[用户描述]"
        ),
        "max_tokens": 500,
        "result_key": "prompt",
        "description": "智能判断并生成/改写提示词"
    },
    "reverse_prompt": {
        "system": (
            "你是一个专业的图像反推提示词助手。请仔细观察给定的图像，反推出用于生成该图像的文生图提示词。\n\n"
            "要求：\n"
            "1. 分析图像中的主体、场景、风格、光影、构图、材质、氛围等所有视觉元素\n"
            "2. 使用英文生成详细的提示词，包含质量词（如：masterpiece, best quality, high resolution 等）\n"
            "3. 提示词应适合 Stable Diffusion 等文生图模型使用\n"
            "4. 仅返回提示词内容，不要包含任何解释、说明、前言或后缀文字\n"
            "5. 不要说'好的'、'这是反推的提示词'等任何多余内容，直接输出提示词本身"
        ),
        "max_tokens": 500,
        "result_key": "prompt",
        "description": "从图像反推文生图提示词"
    },
}


# ==========================================
# Public LLM Task Runner
# ==========================================

def run_llm_task(task_name: str, text: str, extra_system_prompt: Optional[str] = None,
                 images: Optional[Any] = None) -> Dict[str, Any]:
    """
    执行 LLM 任务

    Args:
        task_name: 任务名称，必须在 LLM_TASKS 中定义
        text: 输入文本
        extra_system_prompt: 额外的系统提示词（可选）
        images: 图像数据列表（可选，用于多模态任务）

    Returns:
        dict: 包含 status 和结果的数据，或错误信息
    """
    if task_name not in LLM_TASKS:
        return {"error": f"Invalid task: {task_name}"}

    task_config = LLM_TASKS[task_name]
    system_prompt = task_config["system"]
    max_tokens = task_config["max_tokens"]
    result_key = task_config["result_key"]

    use_remote = get_current_mode() == LLM_MODE_REMOTE

    if task_name == "translate_prompt":
        source_lang = _detect_language(text)

        if source_lang == 'Chinese':
            target_lang = 'English'
        else:
            target_lang = 'Chinese'

        system_prompt += f"\nTranslation Direction: {source_lang} to {target_lang}"
        logger.info(f"Auto-detected translation direction: {source_lang} -> {target_lang}")

        result = TRANSLATION_CACHE.get(text)
        if result:
            logger.info(f"Translation cache HIT for: '{text[:20]}...'")
            return {"status": "success", result_key: result}

    if extra_system_prompt:
        system_prompt = system_prompt + extra_system_prompt

    try:
        result = _run_llm_inference(system_prompt, text, max_tokens, images=images, use_remote=use_remote)
    except Exception as e:
        logger.error(f"Failed to execute task {task_name}: {e}")
        return {"error": f"LLM inference failed: {str(e)}"}

    if not result:
        mode_str = "Remote API" if use_remote else "Local model"
        logger.warning(f"Failed to get response from {mode_str} for task: {task_name}")
        return {"error": f"failed to {task_name.replace('_', ' ')}"}

    if task_name == "translate_prompt":
        TRANSLATION_CACHE.set(text, result)
        logger.info(f"Saved result to cache: '{text[:20]}...' -> '{result[:20]}...'")

    logger.info(f"LLM task {task_name} completed: input='{text[:100]}...', output='{result[:100]}...'")
    return {"status": "success", result_key: result}


def run_llm_task_stream(task_name: str, text: str, extra_system_prompt: Optional[str] = None,
                        images: Optional[Any] = None) -> Generator[str, None, None]:
    """
    流式执行 LLM 任务，返回生成器

    Args:
        task_name: 任务名称，必须在 LLM_TASKS 中定义
        text: 输入文本
        extra_system_prompt: 额外的系统提示词（可选）
        images: 图像数据列表（可选，用于多模态任务）

    Yields:
        str: 生成的文本块
    """
    if task_name not in LLM_TASKS:
        yield f"[ERROR] Invalid task: {task_name}"
        return

    task_config = LLM_TASKS[task_name]
    system_prompt = task_config["system"]
    max_tokens = task_config["max_tokens"]

    use_remote = get_current_mode() == LLM_MODE_REMOTE

    if task_name == "translate_prompt":
        source_lang = _detect_language(text)
        if source_lang == 'Chinese':
            target_lang = 'English'
        else:
            target_lang = 'Chinese'
        system_prompt += f"\nTranslation Direction: {source_lang} to {target_lang}"

    if extra_system_prompt:
        system_prompt = system_prompt + extra_system_prompt

    try:
        result_gen = _run_llm_inference(system_prompt, text, max_tokens, images=images,
                                        use_remote=use_remote, stream=True)
        if hasattr(result_gen, '__iter__') and not isinstance(result_gen, str):
            for chunk in result_gen:
                # 提取 chunk 中的文本内容并逐字 yield
                if isinstance(chunk, dict):
                    choices = chunk.get("choices", [])
                    if choices and len(choices) > 0:
                        delta = choices[0].get("delta", {})
                        content = delta.get("content", "")
                        # 逐字 yield，实现打字效果
                        for char in content:
                            yield char
                elif isinstance(chunk, str):
                    for char in chunk:
                        yield char
        else:
            yield result_gen or ""
    except Exception as e:
        logger.error(f"Failed to execute stream task {task_name}: {e}")
        yield f"[ERROR] {str(e)}"


# ==========================================
# API Handler Functions
# ==========================================

async def handle_llm_api_request(task_name, request):
    """
    处理 LLM API 请求

    Args:
        task_name: 任务名称
        request: 请求对象

    Returns:
        web.json_response: 响应对象
    """
    from aiohttp import web

    if task_name not in LLM_TASKS:
        return web.json_response({"error": "Invalid task"}, status=400)

    try:
        data = await request.json()
        text = data.get("text", "")

        logger.info(f"LLM API request: task={task_name}, text='{text[:100]}...'")

        if not text or not text.strip():
            return web.json_response({"error": "text content is empty"}, status=400)

        result_data = run_llm_task(task_name, text)

        if "error" in result_data:
            error_msg = result_data["error"]
            logger.warning(f"LLM API error: task={task_name}, error={error_msg}")

            if get_current_mode() == LLM_MODE_LOCAL and ("LLM model not found" in error_msg or "Model not loaded" in error_msg):
                return web.json_response({
                    "error": f"Local model is not available. Please download the model first, or switch to remote API mode."
                }, status=422)

            if get_current_mode() == LLM_MODE_REMOTE:
                return web.json_response({
                    "error": f"Remote API error: {error_msg}. Please check your remote_llm_config.json configuration."
                }, status=422)

            return web.json_response({"error": error_msg}, status=422)

        logger.info(f"LLM API response: task={task_name}, result='{result_data.get('prompt', result_data.get('enhanced', result_data.get('translated', '')))[:100]}...'")
        return web.json_response(result_data)

    except Exception as e:
        logger.error(f"Error handling LLM task {task_name}: {e}")
        logger.exception(e)
        return web.json_response({"error": str(e)}, status=500)


async def handle_llm_api_stream(task_name, request):
    """
    处理流式 LLM API 请求（SSE）

    Args:
        task_name: 任务名称
        request: 请求对象

    Returns:
        web.Response: SSE 流式响应
    """
    from aiohttp import web

    if task_name not in LLM_TASKS:
        return web.Response(text="data: [ERROR] Invalid task\n\n", content_type="text/event-stream")

    try:
        data = await request.json()
        text = data.get("text", "")

        logger.info(f"LLM API stream request: task={task_name}, text='{text[:100]}...'")

        if not text or not text.strip():
            return web.Response(text="data: [ERROR] text content is empty\n\n", content_type="text/event-stream")

        async def event_stream():
            try:
                import asyncio
                for chunk in run_llm_task_stream(task_name, text):
                    yield (f"data: {chunk}\n\n").encode()
                    await asyncio.sleep(0.01)  # 10ms 延迟，让浏览器逐字显示
                yield b"data: [DONE]\n\n"
            except Exception as e:
                logger.error(f"Stream error for task {task_name}: {e}")
                yield (f"data: [ERROR] {str(e)}\n\n").encode()
                yield b"data: [DONE]\n\n"

        return web.Response(
            body=event_stream(),
            content_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )
    except Exception as e:
        logger.error(f"Error handling stream LLM task {task_name}: {e}")
        logger.exception(e)
        return web.Response(
            text=f"data: [ERROR] {str(e)}\n\ndata: [DONE]\n\n",
            content_type="text/event-stream"
        )


# ==========================================
# Module Exports
# ==========================================

__all__ = [
    "handle_llm_api_request",
    "handle_llm_api_stream",
    "run_llm_task",
    "run_llm_task_stream",
    "get_remote_llm_config",
    "set_remote_llm_config",
    "get_current_mode",
    "LLM_MODE_LOCAL",
    "LLM_MODE_REMOTE",
    "RemoteLLMClient",
    "check_model_status",
    "check_all_models_status",
    "start_download",
    "get_available_models",
    "set_current_model",
    "scan_llm_directory",
]
