# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes - LLM (Large Language Model)
# LLM 公共代码模块，包含大模型加载、推理、任务定义等功能

from __future__ import annotations

import os
import re
import json
import logging
import base64
import io
from typing import Any, Dict, List, Optional
import folder_paths
from collections import OrderedDict

# ==========================================
# HuggingFace Endpoint Configuration
# ==========================================
# Override HF_ENDPOINT to use official HuggingFace endpoint
# This is needed because some systems set HF_ENDPOINT to a mirror that may be unavailable
os.environ["HF_ENDPOINT"] = "https://huggingface.co"

logger = logging.getLogger(__name__)

# ==========================================
# Model Configuration (loaded from JSON)
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
        # 返回默认配置
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

# 加载配置
_MODEL_CONFIG: Dict[str, Any] = _load_model_config()

def get_model_config():
    """获取模型配置"""
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
# LLM Configuration & Management
# ==========================================

# 当前选择的模型
_current_model_key: str = _MODEL_CONFIG.get("current_model", "Qwen3.5-0.8B") or "Qwen3.5-0.8B"

# 模型配置常量（将在 _update_model_constants() 中初始化）
MS_REPO_ID: str = ""
HF_REPO_ID: str = ""
MODEL_FILENAME: str = ""
MODEL_DIR: str = "Qwen-0.8B"

def get_current_model_config() -> Dict[str, Any]:
    """获取当前模型的配置"""
    models: Dict[str, Any] = _MODEL_CONFIG.get("models", {})
    if _current_model_key in models:
        return models[_current_model_key]  # type: ignore[return-value]
    # 回退到第一个可用模型
    first_key = list(models.keys())[0] if models else "Qwen3.5-0.8B"
    return models.get(first_key, {})  # type: ignore[type-abstract]

def set_current_model(model_key):
    """设置当前模型"""
    global _current_model_key
    models = _MODEL_CONFIG.get("models", {})
    if model_key in models:
        _current_model_key = model_key
        # 更新全局配置常量
        _update_model_constants()
        # 保存配置到文件
        _save_model_config()
        return True
    return False

def _update_model_constants():
    """更新模型配置常量"""
    global MS_REPO_ID, HF_REPO_ID, MODEL_FILENAME, MODEL_DIR
    config = get_current_model_config()
    MS_REPO_ID = config.get("ms_repo_id", "")
    HF_REPO_ID = config.get("hf_repo_id", "")
    MODEL_FILENAME = config.get("filename", "")
    MODEL_DIR = config.get("model_dir", "Qwen-0.8B")

def _save_model_config():
    """保存模型配置到文件"""
    config_path = os.path.join(os.path.dirname(__file__), "model_config.json")
    try:
        _MODEL_CONFIG["current_model"] = _current_model_key
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(_MODEL_CONFIG, f, indent=2, ensure_ascii=False)
        logger.info(f"Model config saved: {_current_model_key}")
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
            "filename": config_dict.get("filename", ""),  # type: ignore[union-attr]
            "model_dir": config_dict.get("model_dir", "")  # type: ignore[union-attr]
        })
    return {
        "current_model": _current_model_key,
        "models": model_list
    }

# 初始化模型常量
_update_model_constants()

_MMPROJ_CONFIG: Dict[str, Any] = _MODEL_CONFIG.get("mmproj", {})  # type: ignore[union-attr]
MMPROJ_FILENAME: str = _MMPROJ_CONFIG.get("filename", "")  # type: ignore[union-attr]

import threading

# 下载状态管理
_download_status = {
    "model": {"downloading": False, "progress": 0, "error": None},
    "mmproj": {"downloading": False, "progress": 0, "error": None}
}
_download_lock = threading.Lock()

def get_model_paths():
    """获取模型文件路径"""
    base_dir = folder_paths.base_path
    model_dir = os.path.join(base_dir, "models", "LLM",MODEL_DIR)
    target_path = os.path.join(model_dir, MODEL_FILENAME)
    mmproj_path = os.path.join(model_dir, MMPROJ_FILENAME)
    return target_path, mmproj_path

def check_model_status():
    """
    检查模型文件是否存在，返回状态信息
    """
    target_path, mmproj_path = get_model_paths()
    
    model_exists = os.path.exists(target_path)
    mmproj_exists = os.path.exists(mmproj_path)
    
    # 如果正在下载，记录当前状态用于调试
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
    """
    检查所有模型文件的状态，返回所有模型的下载状态
    """
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
        "current_model": _current_model_key
    }

def _download_file_background(file_type):
    """
    后台下载文件（在独立线程中运行）
    file_type: "model" 或 "mmproj"
    优先从 ModelScope 下载，失败后尝试 HuggingFace
    """
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
        model_dir = os.path.join(base_dir, "models", "LLM",MODEL_DIR)
        os.makedirs(model_dir, exist_ok=True)
        
        filename = MODEL_FILENAME if file_type == "model" else MMPROJ_FILENAME
        target_path = os.path.join(model_dir, filename)
        
        # 如果文件已存在，直接成功
        if os.path.exists(target_path):
            _download_status[file_type]["downloading"] = False
            _download_status[file_type]["progress"] = 100
            logger.info(f"File already exists: {target_path}")
            return True
        
        # 尝试从 ModelScope 下载
        success = _download_from_modelscope(model_dir, filename, file_type)
        
        if not success:
            logger.info("ModelScope download failed, trying HuggingFace...")
            success = _download_from_huggingface(model_dir, filename, file_type)
        
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

def _download_from_modelscope(model_dir, filename, file_type):
    """从 ModelScope 下载模型"""
    try:
        logger.info(f"Attempting download from ModelScope...")
        from modelscope import snapshot_download
        
        target_path = os.path.join(model_dir, filename)
        estimated_size = 500 * 1024 * 1024  # 默认500MB
        
        # 监控文件大小的进度更新
        download_progress = {"current": 0}
        
        def monitor_file_progress():
            """监控文件下载进度"""
            import time
            last_size = 0
            no_change_count = 0
            max_size_seen = 0
            iteration = 0
            
            while _download_status[file_type]["downloading"]:
                iteration += 1
                # 检查目标文件和可能的临时文件
                checked_size = 0
                if os.path.exists(target_path):
                    checked_size = os.path.getsize(target_path)
                else:
                    # 检查目录中是否有正在下载的文件
                    if os.path.exists(model_dir):
                        for fname in os.listdir(model_dir):
                            fpath = os.path.join(model_dir, fname)
                            if os.path.isfile(fpath):
                                fsize = os.path.getsize(fpath)
                                if fsize > checked_size:
                                    checked_size = fsize
                                    logger.debug(f"Found larger file during download: {fname} = {fsize}")
                
                if checked_size > 0:
                    # 更新最大文件大小
                    if checked_size > max_size_seen:
                        max_size_seen = checked_size
                        logger.info(f"Download progress: size={checked_size}, max={max_size_seen}")
                    
                    # 使用已看到的最大文件大小来估算进度
                    # 假设文件大小在 max_size_seen 的 1.0-1.5 倍之间
                    estimated_total = max(max_size_seen * 1.2, max_size_seen + (50 * 1024 * 1024))
                    progress = min(int((checked_size / estimated_total) * 100), 99)
                    download_progress["current"] = progress
                    _download_status[file_type]["progress"] = progress
                    logger.info(f"Updated progress: {progress}% (size={checked_size}, estimated={estimated_total})")
                    
                    # 检查文件大小是否稳定
                    if checked_size == last_size and checked_size > 0:
                        no_change_count += 1
                        if no_change_count >= 15:  # 连续15次大小不变，可能完成
                            logger.info("File size stable, marking download as complete")
                            _download_status[file_type]["progress"] = 100
                            break
                    else:
                        no_change_count = 0
                        last_size = checked_size
                time.sleep(0.2)
        
        progress_thread = threading.Thread(target=monitor_file_progress, daemon=True)
        progress_thread.start()
        
        # 下载指定模型到指定目录
        download_path = snapshot_download(
            MS_REPO_ID,
            allow_patterns=[filename],  # 精确匹配要下载的GGUF文件
            local_dir=model_dir,
            revision='master',
        )
        
        # 等待进度线程完成
        progress_thread.join(timeout=3)
        
        # 检查目标文件是否存在
        if os.path.exists(target_path):
            _download_status[file_type]["progress"] = 100
            logger.info(f"Downloaded from ModelScope: {target_path}")
            return True
        else:
            logger.warning(f"ModelScope download did not create expected file")
            return False
    except ImportError:
        logger.warning("modelscope not installed, trying HuggingFace...")
        return False
    except Exception as e:
        logger.error(f"ModelScope download failed: {e}")
        return False

def _download_from_huggingface(model_dir, filename, file_type):
    """从 HuggingFace 下载模型"""
    try:
        logger.info(f"Attempting download from HuggingFace...")
        from huggingface_hub import hf_hub_download
        
        target_path = os.path.join(model_dir, filename)
        
        # 监控文件大小的进度更新
        def monitor_file_progress():
            """监控文件下载进度"""
            import time
            last_size = 0
            no_change_count = 0
            max_size_seen = 0
            
            while _download_status[file_type]["downloading"]:
                if os.path.exists(target_path):
                    current_size = os.path.getsize(target_path)
                    if current_size > 0:
                        # 更新最大文件大小
                        if current_size > max_size_seen:
                            max_size_seen = current_size
                        
                        # 使用已看到的最大文件大小来估算进度
                        # 假设文件大小在 max_size_seen 的 1.2-1.5 倍之间
                        estimated_total = max(max_size_seen * 1.3, max_size_seen + (100 * 1024 * 1024))
                        progress = min(int((current_size / estimated_total) * 100), 99)
                        _download_status[file_type]["progress"] = progress
                        
                        # 检查文件大小是否稳定
                        if current_size == last_size and current_size > 0:
                            no_change_count += 1
                            if no_change_count >= 10:  # 连续10次大小不变，可能完成
                                _download_status[file_type]["progress"] = 100
                                break
                        else:
                            no_change_count = 0
                            last_size = current_size
                time.sleep(0.3)
        
        progress_thread = threading.Thread(target=monitor_file_progress, daemon=True)
        progress_thread.start()
        
        downloaded_path = hf_hub_download(
            repo_id=str(HF_REPO_ID),
            filename=str(filename),
            local_dir=str(model_dir),
            force_download=False,
        )
        
        # 等待进度线程完成
        progress_thread.join(timeout=3)
        
        _download_status[file_type]["progress"] = 100
        logger.info(f"Downloaded from HuggingFace: {downloaded_path}")
        return True
    except Exception as e:
        logger.error(f"HuggingFace download failed: {e}")
        return False

def start_download(file_type):
    """
    启动后台下载任务（非阻塞）
    """
    if file_type not in ["model", "mmproj"]:
        return {"error": "Invalid file type"}
    
    target_path, _ = get_model_paths()
    if file_type == "model" and os.path.exists(target_path):
        return {"status": "already_exists"}
    
    _, mmproj_path = get_model_paths()
    if file_type == "mmproj" and os.path.exists(mmproj_path):
        return {"status": "already_exists"}
    
    # 在后台线程中下载
    thread = threading.Thread(target=_download_file_background, args=(file_type,), daemon=True)
    thread.start()
    
    return {"status": "started", "file_type": file_type}

class LLMSingleton:
    """LLM 单例模式，确保模型只加载一次"""
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
        """加载 LLM 模型，不再自动下载，如果模型不存在则直接报错"""
        target_path, mmproj_path = get_model_paths()
        
        # 确保模型目录存在
        model_dir = os.path.dirname(target_path)
        os.makedirs(model_dir, exist_ok=True)
        
        # 检查主模型文件是否存在（不下载）
        if not os.path.exists(target_path):
            raise RuntimeError(
                f"LLM model not found. "
                f"Please download {MODEL_FILENAME} from ModelScope or HuggingFace "
                f"and place it in: {model_dir}/"
            )

        # 检查 mmproj 文件（可选，不下载）
        if not os.path.exists(mmproj_path):
            logger.warning(
                f"mmproj file not found: {mmproj_path}. "
                f"Image understanding will not work. "
                f"Please download {MMPROJ_FILENAME} from ModelScope or HuggingFace "
                f"and place it in: {model_dir}/"
            )
            mmproj_path = None
        
        from llama_cpp import Llama
        
        # 构建模型加载参数
        llama_kwargs = {
            "model_path": target_path,
            "n_ctx": 2048,
            "n_threads": 4,
            "n_gpu_layers": -1,
            "verbose": False,
        }
        
        # 如果找到 mmproj 文件，添加到参数中
        if mmproj_path:
            logger.info(f"Loading mmproj file: {mmproj_path}")
            llama_kwargs["mmproj"] = mmproj_path
            self.mmproj_path = mmproj_path
        else:
            logger.warning("No mmproj file found, loading text-only model. Image understanding will not work.")
        
        self.model = Llama(**llama_kwargs)
        self.has_mmproj = mmproj_path is not None

    def create_chat_completion(self, messages, max_tokens, image_bytes_list=None):
        """
        创建聊天补全请求，支持图像输入
        图像通过 messages 中的 content 数组传递，使用 base64 data URI 格式
        """
        if self.model is None:
            raise RuntimeError("LLM Model not loaded")
        
        # 如果有图像输入，将图像嵌入到 messages 中
        if image_bytes_list and len(image_bytes_list) > 0:
            new_messages = []
            for msg in messages:
                if msg.get("role") == "user":
                    content_list = []
                    # 将图像作为 image_url 添加到内容中
                    for img_bytes in image_bytes_list:
                        if isinstance(img_bytes, (bytes, bytearray)):
                            b64 = base64.b64encode(img_bytes).decode('utf-8')
                            data_uri = f"data:image/png;base64,{b64}"
                        elif isinstance(img_bytes, str):
                            data_uri = img_bytes
                        else:
                            continue
                        content_list.append({"type": "image_url", "image_url": {"url": data_uri}})
                    # 添加文本内容
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
    """获取 LLM 单例实例"""
    return LLMSingleton.get_instance()


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
# LLM Inference Functions
# ==========================================

def _run_llm_inference(system_prompt, user_text, max_tokens, images=None):
    """
    执行 LLM 推理，支持图像输入
    images: PIL Image 对象列表或字节数据列表
    """
    llm = get_llm_instance()
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text}
    ]
    
    try:
        # 将 PIL 图像或字节数据转换为字节列表
        image_bytes_list = None
        if images is not None and len(images) > 0:
            image_bytes_list = []
            for img in images:
                if hasattr(img, 'tobytes'):
                    # PIL Image 对象
                    buffer = io.BytesIO()
                    img.save(buffer, format='PNG')
                    image_bytes_list.append(buffer.getvalue())
                elif isinstance(img, (bytes, bytearray)):
                    image_bytes_list.append(img)
                elif hasattr(img, 'read'):
                    # 文件-like 对象
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
            logger.warning(f"LLM response 'choices' is empty or invalid.")
            return None
        
        message = choices[0].get('message', {})
        content = message.get('content', '')
        
        if not content:
            logger.warning(f"LLM 'content' is None.")
            return ""
            
        return content.strip()
    except Exception as e:
        logger.exception(f"Error during LLM inference: {e}")
        return None


def run_llm_task(task_name, text, extra_system_prompt=None, images=None):
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
    
    # 处理翻译任务的特殊逻辑
    if task_name == "translate_prompt":
        source_lang = _detect_language(text)
        
        if source_lang == 'Chinese':
            target_lang = 'English'
        else:
            target_lang = 'Chinese'
        
        system_prompt += f"\nTranslation Direction: {source_lang} to {target_lang}"
        logger.info(f"Auto-detected translation direction: {source_lang} -> {target_lang}")
        
        # 检查缓存
        result = TRANSLATION_CACHE.get(text)
        if result:
            logger.info(f"Translation cache HIT for: '{text[:20]}...'")
            return {"status": "success", result_key: result}
        else:
            logger.info(f"Translation cache MISS for: '{text[:30]}...'")
    
    # 执行推理
    if extra_system_prompt:
        system_prompt = system_prompt + extra_system_prompt
    
    result = _run_llm_inference(system_prompt, text, max_tokens, images=images)
    
    if not result:
        logger.warning(f"Failed to execute task: {task_name}")
        return {"error": f"failed to {task_name.replace('_', ' ')}"}
    
    # 缓存翻译结果
    if task_name == "translate_prompt":
        TRANSLATION_CACHE.set(text, result)
        logger.info(f"Saved result to cache: '{text[:20]}...' -> '{result[:20]}...'")
    
    return {"status": "success", result_key: result}


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
            return web.json_response({"error": result_data["error"]}, status=422)
        
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
]