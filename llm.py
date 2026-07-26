# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes - LLM (Large Language Model)
# LLM 公共代码模块，支持本地模型和远程 API

from __future__ import annotations

import os
import re
import json
import logging
import base64
import io
import hashlib
from typing import Any, Dict, List, Optional
from pathlib import Path
import folder_paths
from collections import OrderedDict

# ==========================================
# HuggingFace Endpoint Configuration
# ==========================================
os.environ["HF_ENDPOINT"] = "https://huggingface.co"

logger = logging.getLogger(__name__)

# ==========================================
# LLM Configuration & Management
# ==========================================

def _load_model_config():
    """从 model_config.json 加载模型配置"""
    config_path = os.path.join(os.path.dirname(__file__), "model_config.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        return config
    except Exception as e:
        logger.error(f"Failed to load model config: {e}")
        # 返回空字典，让其他函数使用默认值
        return {}

_MODEL_CONFIG: Dict[str, Any] = _load_model_config()

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
    
    def __init__(self, max_size=200):
        self._store = OrderedDict()
        self.max_size = max_size
    
    def get(self, text):
        normalized = _normalize_text(text)
        return self._store.get(normalized)
    
    def set(self, text, result):
        normalized_text = _normalize_text(text)
        normalized_result = _normalize_text(result)
        
        if normalized_text in self._store:
            del self._store[normalized_text]
        if normalized_result in self._store:
            del self._store[normalized_result]
        
        self._store[normalized_text] = normalized_result
        self._store[normalized_result] = normalized_text
        
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

# 配置文件路径
_CONFIG_DIR = os.path.dirname(__file__)
_REMOTE_CONFIG_PATH = os.path.join(_CONFIG_DIR, "remote_llm_config.json")

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

# 每个任务对应的模型配置（远程 API 使用）
_TASK_MODEL_CONFIGS = {
    "extract_title": {"max_tokens": 20, "model_override": None},
    "extract_classify": {"max_tokens": 50, "model_override": None},
    "enhance_prompt": {"max_tokens": 500, "model_override": None},
    "translate_prompt": {"max_tokens": 500, "model_override": None},
    "generate_prompt": {"max_tokens": 500, "model_override": None},
    "random_prompt": {"max_tokens": 500, "model_override": None},
}

def get_task_config(task_name: str) -> Dict[str, Any]:
    """获取任务配置"""
    return _TASK_MODEL_CONFIGS.get(task_name, {"max_tokens": 500, "model_override": None})


# ==========================================
# Text Normalization Utility (for local model config)
# ==========================================

def get_current_model_config() -> Dict[str, Any]:
    """获取当前模型的配置"""
    models: Dict[str, Any] = _MODEL_CONFIG.get("models", {})
    _current_model_key: str = _MODEL_CONFIG.get("current_model", "Qwen3.5-0.8B") or "Qwen3.5-0.8B"
    if _current_model_key in models:
        return models[_current_model_key]  # type: ignore[return-value]
    first_key = list(models.keys())[0] if models else "Qwen3.5-0.8B"
    return models.get(first_key, {})  # type: ignore[type-abstract]

def set_current_model(model_key):
    """设置当前模型"""
    global _MODEL_CONFIG
    models = _MODEL_CONFIG.get("models", {})
    if model_key in models:
        _MODEL_CONFIG["current_model"] = model_key
        _save_model_config()
        return True
    return False

def _save_model_config():
    """保存模型配置到文件"""
    config_path = os.path.join(os.path.dirname(__file__), "model_config.json")
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(_MODEL_CONFIG, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to save model config: {e}")

def get_available_models():
    """获取所有可用模型列表"""
    models: Dict[str, Any] = _MODEL_CONFIG.get("models", {})
    model_list: List[Dict[str, str]] = []
    for key, config in models.items():
        config_dict: Dict[str, str] = config  # type: ignore[assignment]
        model_list.append({
            "key": key,
            "name": key,
            "filename": config_dict.get("filename", ""),
            "model_dir": config_dict.get("model_dir", "")
        })
    return {
        "current_model": _MODEL_CONFIG.get("current_model", "Qwen3.5-0.8B"),
        "models": model_list
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

def _read_model_config_from_file():
    """从文件重新读取模型配置（用于运行时动态获取最新配置）"""
    config_path = os.path.join(os.path.dirname(__file__), "model_config.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read model config from file: {e}")
        return {}

def get_model_paths():
    """获取模型文件路径 - 每次都从文件读取最新配置"""
    # 每次都从文件重新读取配置，确保使用最新的 current_model
    config = _read_model_config_from_file()
    
    if not config:
        # 如果无法读取配置，使用缓存的
        config = _MODEL_CONFIG
    
    # 获取当前模型配置
    models: Dict[str, Any] = config.get("models", {})
    current_model_key: str = config.get("current_model", "Qwen3.5-0.8B") or "Qwen3.5-0.8B"
    
    # 如果 models 字典存在，使用当前模型配置
    if current_model_key in models:
        model_cfg = models[current_model_key]
    else:
        # 回退到旧的单模型配置格式
        model_cfg = config.get("model", {})
    
    MODEL_FILENAME = model_cfg.get("filename", "")
    MODEL_DIR = model_cfg.get("model_dir", "Qwen-0.8B")
    
    base_dir = folder_paths.base_path
    model_dir = os.path.join(base_dir, "models", "LLM", MODEL_DIR)
    target_path = os.path.join(model_dir, MODEL_FILENAME)
    
    # mmproj 配置（所有模型共享）
    MMPROJ_FILENAME = config.get("mmproj", {}).get("filename", "mmproj-BF16.gguf")
    mmproj_path = os.path.join(model_dir, MMPROJ_FILENAME)
    return target_path, mmproj_path

def check_model_status():
    """检查模型文件是否存在，返回状态信息"""
    target_path, mmproj_path = get_model_paths()
    
    model_exists = os.path.exists(target_path)
    mmproj_exists = os.path.exists(mmproj_path)
    
    # 从文件读取最新配置
    config = _read_model_config_from_file()
    if not config:
        config = _MODEL_CONFIG
    
    models: Dict[str, Any] = config.get("models", {})
    current_model_key: str = config.get("current_model", "Qwen3.5-0.8B") or "Qwen3.5-0.8B"
    
    if current_model_key in models:
        model_cfg = models[current_model_key]
    else:
        model_cfg = config.get("model", {})
    
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
    """检查所有模型文件的状态"""
    base_dir = folder_paths.base_path
    models_config: Dict[str, Any] = _MODEL_CONFIG.get("models", {})
    
    models_status: List[Dict[str, Any]] = []
    for key, config in models_config.items():
        config_dict: Dict[str, Any] = config  # type: ignore[assignment]
        model_dir: str = config_dict.get("model_dir", "")  # type: ignore[union-attr]
        filename: str = config_dict.get("filename", "")  # type: ignore[union-attr]
        
        model_path = os.path.join(base_dir, "models", "LLM", model_dir, filename)
        exists = os.path.exists(model_path)
        
        models_status.append({
            "key": key,
            "name": key,
            "filename": filename,
            "model_dir": model_dir,
            "available": exists
        })
    
    return {
        "models": models_status,
        "current_model": _MODEL_CONFIG.get("current_model", "Qwen3.5-0.8B")
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
        
        # 获取当前模型配置
        if file_type == "model":
            models: Dict[str, Any] = _MODEL_CONFIG.get("models", {})
            current_model_key: str = _MODEL_CONFIG.get("current_model", "Qwen3.5-0.8B") or "Qwen3.5-0.8B"
            
            if current_model_key in models:
                model_cfg = models[current_model_key]
            else:
                model_cfg = _MODEL_CONFIG.get("model", {})
            
            filename = model_cfg.get("filename", "")
            MODEL_DIR = model_cfg.get("model_dir", "Qwen-0.8B")
            MS_REPO_ID = model_cfg.get("ms_repo_id", "")
            HF_REPO_ID = model_cfg.get("hf_repo_id", "")
        else:
            filename = _MODEL_CONFIG.get("mmproj", {}).get("filename", "")
            MODEL_DIR = _MODEL_CONFIG.get("model", {}).get("model_dir", "Qwen-0.8B")
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
    """从 ModelScope 下载模型 - 保留向后兼容"""
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
    """从 HuggingFace 下载模型 - 保留向后兼容"""
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
# Remote API LLM Client
# ==========================================

class RemoteLLMClient:
    """远程 LLM API 客户端，支持多种提供商"""
    
    # 支持的提供商
    PROVIDER_OPENAI = "openai"
    PROVIDER_ANTHROPIC = "anthropic"
    PROVIDER_OLLAMA = "ollama"
    PROVIDER_LM_STUDIO = "lmstudio"
    PROVIDER_LLAMACPP = "llamacpp"
    PROVIDER_VLLM = "vllm"
    PROVIDER_ZHIPU = "zhipu"
    PROVIDER_DOUBAO = "doubao"
    
    # 提供商对应的系统提示词处理
    SUPPORTED_PROVIDERS = [PROVIDER_OPENAI, PROVIDER_ANTHROPIC, PROVIDER_OLLAMA, 
                           PROVIDER_LM_STUDIO, PROVIDER_LLAMACPP, PROVIDER_VLLM, PROVIDER_ZHIPU, PROVIDER_DOUBAO]
    
    def __init__(self, config: Dict[str, Any]):
        """
        初始化远程 LLM 客户端
        
        Args:
            config: 配置字典，包含 provider, api_key, base_url, model, max_tokens, temperature, timeout
        """
        self.config = config
        self.provider = config.get("provider", self.PROVIDER_OPENAI)
        self.api_key = config.get("api_key", "")
        self.base_url = config.get("base_url", "").rstrip("/")
        self.model = config.get("model", "gpt-4o-mini")
        self.max_tokens = config.get("max_tokens", 500)
        self.temperature = config.get("temperature", 0.0)
        self.timeout = config.get("timeout", 60)
        
    def chat_completion(self, messages: List[Dict[str, Any]], 
                       max_tokens: Optional[int] = None,
                       image_bytes_list: Optional[List[bytes]] = None) -> Dict[str, Any]:
        """
        创建聊天补全请求
        
        Args:
            messages: 消息列表，格式为 [{"role": "user", "content": "..."}]
            max_tokens: 最大 token 数
            image_bytes_list: 图像字节数据列表（可选）
            
        Returns:
            API 响应字典
        """
        if not self.api_key:
            raise ValueError("API Key is not configured")
        
        effective_max_tokens = max_tokens or self.max_tokens
        
        # 根据提供商选择对应的请求方法
        if self.provider in (self.PROVIDER_OPENAI, self.PROVIDER_LLAMACPP, self.PROVIDER_VLLM, 
                              self.PROVIDER_ZHIPU, self.PROVIDER_DOUBAO, self.PROVIDER_LM_STUDIO):
            return self._openai_format_request(messages, effective_max_tokens, image_bytes_list)
        elif self.provider == self.PROVIDER_ANTHROPIC:
            return self._anthropic_format_request(messages, effective_max_tokens, image_bytes_list)
        elif self.provider in (self.PROVIDER_OLLAMA,):
            return self._ollama_format_request(messages, effective_max_tokens, image_bytes_list)
        else:
            raise ValueError(f"Unsupported provider: {self.provider}")
    
    def _openai_format_request(self, messages: List[Dict[str, Any]], 
                                max_tokens: int,
                                image_bytes_list: Optional[List[bytes]] = None) -> Dict[str, Any]:
        """OpenAI 格式的请求（兼容 OpenAI、LM Studio、llama.cpp、vLLM、智谱、豆包等）"""
        import requests
        
        # 构建请求消息列表
        request_messages = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            
            # 处理图像（如果有）
            if image_bytes_list and isinstance(content, str) and role == "user":
                content = self._text_with_images_to_content(content, image_bytes_list)
            
            request_messages.append({"role": role, "content": content})
        
        # 构建请求 URL
        url = self._build_url()
        
        # 构建请求体
        payload = {
            "model": self.model,
            "messages": request_messages,
            "max_tokens": max_tokens,
            "temperature": self.temperature,
        }
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        # OpenAI 兼容的提供商可能需要特殊的 header
        if self.provider == self.PROVIDER_ZHIPU:
            headers["Authorization"] = f"api_key={self.api_key}"
        elif self.provider == self.PROVIDER_DOUBAO:
            # 豆包使用 API ID 和 Key
            pass  # 标准 Bearer token 通常也适用
        elif self.provider == self.PROVIDER_LM_STUDIO:
            # LM Studio 不需要 API key（本地服务器）
            # 但如果配置了则使用
            if not self.api_key:
                headers.pop("Authorization", None)
        
        response = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
        response.raise_for_status()
        
        result = response.json()
        
        # 标准化响应格式为 OpenAI 格式
        choices = result.get("choices", [])
        if not choices:
            return {"choices": []}
        
        message = choices[0].get("message", {})
        content = message.get("content", "")
        
        return {
            "choices": [{
                "message": {"role": "assistant", "content": content}
            }]
        }
    
    def _build_url(self) -> str:
        """构建 API URL"""
        url = f"{self.base_url}/chat/completions" if self.base_url else "https://api.openai.com/v1/chat/completions"
        
        # 如果 base_url 不包含 /v1，自动添加
        if not self.base_url and self.provider == self.PROVIDER_OPENAI:
            url = "https://api.openai.com/v1/chat/completions"
        elif self.base_url and not self.base_url.endswith("/v1") and "/chat/completions" not in url:
            # 检查 URL 格式
            if url.endswith("/"):
                url = f"{url}v1/chat/completions"
            else:
                url = f"{url}/v1/chat/completions"
        
        return url
    
    def _anthropic_format_request(self, messages: List[Dict[str, Any]],
                                  max_tokens: int,
                                  image_bytes_list: Optional[List[bytes]] = None) -> Dict[str, Any]:
        """Anthropic Claude 格式的请求"""
        import requests
        
        # Anthropic API 端点
        url = f"{self.base_url or 'https://api.anthropic.com'}/v1/messages"
        
        # 提取系统提示词和用户消息
        system_prompt = ""
        user_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_prompt = msg.get("content", "")
            elif msg.get("role") == "user":
                user_messages.append(msg.get("content", ""))
        
        # 合并用户消息
        user_content = "\n\n".join(user_messages)
        
        # 处理图像
        if image_bytes_list:
            content_parts = [{"type": "text", "text": user_content}]
            for img_bytes in image_bytes_list:
                b64 = base64.b64encode(img_bytes).decode('utf-8')
                content_parts.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": b64
                    }
                })
            content = content_parts
        else:
            content = user_content
        
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": content
                }
            ],
            "max_tokens": max_tokens,
            "temperature": self.temperature,
        }
        
        if system_prompt:
            payload["system"] = system_prompt
        
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01"
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
        response.raise_for_status()
        
        result = response.json()
        
        # 转换为标准格式
        content_blocks = result.get("content", [])
        assistant_content = ""
        for block in content_blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                assistant_content += block.get("text", "")
        
        return {
            "choices": [{
                "message": {"role": "assistant", "content": assistant_content.strip()}
            }]
        }
    
    def _ollama_format_request(self, messages: List[Dict[str, Any]], 
                                max_tokens: int,
                                image_bytes_list: Optional[List[bytes]] = None) -> Dict[str, Any]:
        """Ollama 格式的请求"""
        import requests
        
        # Ollama 默认端点
        url = f"{self.base_url or 'http://localhost:11430'}/api/chat"
        
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "num_predict": max_tokens,
                "temperature": self.temperature
            }
        }
        
        headers = {"Content-Type": "application/json"}
        
        response = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
        response.raise_for_status()
        
        result = response.json()
        
        # Ollama 返回格式
        message = result.get("message", {})
        content = message.get("content", "")
        
        return {
            "choices": [{
                "message": {"role": "assistant", "content": content}
            }]
        }
    
    def _text_with_images_to_content(self, text: str, image_bytes_list: List[bytes]) -> List[dict]:
        """将文本和图像转换为 OpenAI 兼容的内容格式"""
        content = []
        
        # 添加图像
        for img_bytes in image_bytes_list:
            b64 = base64.b64encode(img_bytes).decode('utf-8')
            data_uri = f"data:image/png;base64,{b64}"
            content.append({
                "type": "image_url",
                "image_url": {"url": data_uri}
            })
        
        # 添加文本
        content.append({
            "type": "text",
            "text": text
        })
        
        return content
    
    def is_available(self) -> bool:
        """检查远程 API 是否可用"""
        if not self.api_key:
            return False
        if not self.provider:
            return False
        return True


# ==========================================
# LLM Singleton (Local Mode)
# ==========================================

class LLMSingleton:
    """LLM 单例模式，确保模型只加载一次（本地模式）"""
    _instance = None
    _lock = False
    
    @classmethod
    def get_instance(cls):
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
        
        if not os.path.exists(target_path):
            # 从文件读取最新配置用于错误提示
            config = _read_model_config_from_file()
            if not config:
                config = _MODEL_CONFIG
            
            models: Dict[str, Any] = config.get("models", {})
            current_model_key: str = config.get("current_model", "Qwen3.5-0.8B") or "Qwen3.5-0.8B"
            
            if current_model_key in models:
                model_cfg = models[current_model_key]
            else:
                model_cfg = config.get("model", {})
            
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

    def create_chat_completion(self, messages, max_tokens, image_bytes_list=None):
        """创建聊天补全请求，支持图像输入"""
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
        )


def get_llm_instance():
    """获取 LLM 单例实例（本地模式）"""
    return LLMSingleton.get_instance()


# ==========================================
# Unified LLM Inference Engine
# ==========================================

def _run_llm_inference(system_prompt: str, user_text: str, max_tokens: int, 
                       images: Optional[Any] = None, use_remote: bool = False) -> Optional[str]:
    """
    执行 LLM 推理，支持本地和远程模式
    
    Args:
        system_prompt: 系统提示词
        user_text: 用户文本
        max_tokens: 最大 token 数
        images: PIL Image 对象列表或字节数据列表（仅本地模式支持）
        use_remote: 是否使用远程 API
        
    Returns:
        LLM 响应文本
    """
    if use_remote:
        return _run_remote_inference(system_prompt, user_text, max_tokens, images)
    else:
        return _run_local_inference(system_prompt, user_text, max_tokens, images)


def _run_local_inference(system_prompt: str, user_text: str, max_tokens: int,
                         images: Optional[Any] = None) -> Optional[str]:
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
            image_bytes_list=image_bytes_list
        )
        
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
                          images: Optional[Any] = None) -> Optional[str]:
    """执行远程 LLM 推理"""
    config = _load_remote_config()
    
    if not config.get("enabled", False):
        raise RuntimeError("Remote LLM is not enabled. Please configure remote_llm_config.json")
    
    client = RemoteLLMClient(config)
    
    if not client.is_available():
        raise RuntimeError("Remote LLM client is not available (missing API key or provider)")
    
    # 构建消息
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text}
    ]
    
    try:
        # 处理图像（如果有）
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
        
        response = client.chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            image_bytes_list=image_bytes_list
        )
        
        choices = response.get("choices", [])
        if not choices:
            logger.warning("Remote LLM response 'choices' is empty.")
            return ""
        
        message = choices[0].get("message", {})
        content = message.get("content", "")
        
        return content.strip() if content else ""
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
            "4.保持英文输出，适合文生图模型使用。"
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
    "generate_prompt": {
        "system": (
            "你是一个专业的文生图提示词生成助手。"
            "请根据用户提供的简洁文字描述，生成一段详细的文生图提示词。"
            "要求：1.保留用户描述的核心内容；2.添加细节描述（光影、材质、氛围等）；"
            "3.根据输入语言确定输出语言，适合文生图模型使用；"
            "4.补充高清，高质量等描述，但不要重复描述"
            "5.只返回生成的提示词内容，不要包含任何解释或额外文字。"
        ),
        "max_tokens": 500,
        "result_key": "prompt",
        "description": "从简洁文字生成提示词"
    },
    "random_prompt": {
        "system": (
            "你是一个创意提示词生成助手。"
            "请随机生成一段有创意的文生图提示词。"
            "要求：1.包含主体、场景、风格、光影等元素；"
            "2.使用英文输出，适合文生图模型使用；"
            "3.添加质量词（如：masterpiece, best quality, high resolution 等）；"
            "4.只返回生成的提示词内容，不要包含任何解释或额外文字。"
        ),
        "max_tokens": 500,
        "result_key": "prompt",
        "description": "随机生成提示词"
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
    
    # 确定使用远程还是本地模式
    use_remote = get_current_mode() == LLM_MODE_REMOTE
    
    # 处理翻译任务的特殊逻辑
    if task_name == "translate_prompt":
        source_lang = _detect_language(text)
        
        if source_lang == 'Chinese':
            target_lang = 'English'
        else:
            target_lang = 'Chinese'
        
        system_prompt += f"\nTranslation Direction: {source_lang} to {target_lang}"
        logger.info(f"Auto-detected translation direction: {source_lang} -> {target_lang}")
        
        # 检查缓存（远程和本地共用）
        result = TRANSLATION_CACHE.get(text)
        if result:
            logger.info(f"Translation cache HIT for: '{text[:20]}...'")
            return {"status": "success", result_key: result}
    
    # 应用额外的系统提示词
    if extra_system_prompt:
        system_prompt = system_prompt + extra_system_prompt
    
    # 执行推理
    try:
        result = _run_llm_inference(system_prompt, text, max_tokens, images=images, use_remote=use_remote)
    except Exception as e:
        logger.error(f"Failed to execute task {task_name}: {e}")
        return {"error": f"LLM inference failed: {str(e)}"}
    
    if not result:
        mode_str = "Remote API" if use_remote else "Local model"
        logger.warning(f"Failed to get response from {mode_str} for task: {task_name}")
        return {"error": f"failed to {task_name.replace('_', ' ')}"}
    
    # 缓存翻译结果
    if task_name == "translate_prompt":
        TRANSLATION_CACHE.set(text, result)
        logger.info(f"Saved result to cache: '{text[:20]}...' -> '{result[:20]}...'")
    
    return {"status": "success", result_key: result}


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
        
        if not text or not text.strip():
            return web.json_response({"error": "text content is empty"}, status=400)
        
        result_data = run_llm_task(task_name, text)
        
        if "error" in result_data:
            error_msg = result_data["error"]
            
            # 如果是本地模式且模型未加载，提供有用的提示
            if get_current_mode() == LLM_MODE_LOCAL and "LLM model not found" in error_msg or \
               get_current_mode() == LLM_MODE_LOCAL and "Model not loaded" in error_msg:
                return web.json_response({
                    "error": f"Local model is not available. Please download the model first, or switch to remote API mode."
                }, status=422)
            
            # 如果是远程模式且配置不正确，提供有用的提示
            if get_current_mode() == LLM_MODE_REMOTE:
                return web.json_response({
                    "error": f"Remote API error: {error_msg}. Please check your remote_llm_config.json configuration."
                }, status=422)
            
            return web.json_response({"error": error_msg}, status=422)
        
        return web.json_response(result_data)
        
    except Exception as e:
        logger.error(f"Error handling LLM task {task_name}: {e}")
        logger.exception(e)
        return web.json_response({"error": str(e)}, status=500)


# ==========================================
# Module Exports
# ==========================================

__all__ = [
    "handle_llm_api_request",
    "run_llm_task",
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
]