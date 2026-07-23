# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes - LLM (Large Language Model)
# LLM 公共代码模块，包含大模型加载、推理、任务定义等功能

import os
import re
import logging
import base64
import io
import folder_paths
from collections import OrderedDict

logger = logging.getLogger(__name__)

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
        """加载 LLM 模型，支持自动下载和多模态项目（mmproj）"""
        # 使用 Qwen3.5-0.8B 模型，支持图像理解（多模态）
        MODEL_REPO_ID = "lmstudio-community/Qwen3.5-0.8B-GGUF"
        MODEL_FILENAME = "Qwen3.5-0.8B-Q4_K_M.gguf"
        MMPROJ_FILENAME = "mmproj-Qwen3.5-0.8B-BF16.gguf"
        
        base_dir = folder_paths.base_path
        model_dir = os.path.join(base_dir, "models", "LLM")
        target_path = os.path.join(model_dir, MODEL_FILENAME)
        mmproj_path = os.path.join(model_dir, MMPROJ_FILENAME)
        
        # 确保模型目录存在
        os.makedirs(model_dir, exist_ok=True)
        
        # 下载主模型文件
        if not os.path.exists(target_path):
            logger.info(f"LLM model not found in ComfyUI models directory.")
            logger.info(f"Attempting to download from HuggingFace to: {target_path}")
            
            try:
                from huggingface_hub import hf_hub_download
                downloaded_path = hf_hub_download(
                    repo_id=str(MODEL_REPO_ID),
                    filename=str(MODEL_FILENAME),
                    local_dir=str(model_dir),
                )
                logger.info(f"Model download complete: {downloaded_path}")
                target_path = downloaded_path
            except Exception as e:
                logger.error(f"Model download failed: {e}")
                raise RuntimeError(f"LLM Model download failed: {e}")

        # 下载 mmproj 文件
        if not os.path.exists(mmproj_path):
            logger.info(f"mmproj file not found. Attempting to download from HuggingFace.")
            
            try:
                from huggingface_hub import hf_hub_download
                downloaded_path = hf_hub_download(
                    repo_id=str(MODEL_REPO_ID),
                    filename=str(MMPROJ_FILENAME),
                    local_dir=str(model_dir),
                )
                logger.info(f"mmproj download complete: {downloaded_path}")
                mmproj_path = downloaded_path
            except Exception as e:
                logger.error(f"mmproj download failed: {e}")
                logger.warning("Continuing without mmproj file. Image understanding will not work.")
                mmproj_path = None
        
        if not os.path.exists(target_path):
            raise RuntimeError(f"Could not find or download LLM model at {target_path}")

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
    "describe_image": {
        "system": (
            "你是一个专业的图像描述助手。"
            "请根据给定的图像内容，生成一段文字描述。"
            "要求：1.描述图像中的主体，人物、衣着，场景、风格、色彩等元素；"
            "2.使用准确的中文描述；"
            "3.适合用于文生图模型的提示词；"
            "4.只返回描述内容，不要包含任何解释或额外文字。"
        ),
        "max_tokens": 500,
        "result_key": "description",
        "description": "图像描述反推（默认）"
    },
    "describe_image_concise": {
        "system": (
            "你是一个专业的图像描述助手。"
            "请根据给定的图像内容，生成一段简洁的文字描述。"
            "要求：1.只描述图像中的主要主体和场景；"
            "2.使用相对简短中文描述，不超过200个字；"
            "3.忽略细节和背景元素；"
            "4.只返回描述内容，不要包含任何解释或额外文字。"
        ),
        "max_tokens": 200,
        "result_key": "description",
        "description": "图像描述反推（简约）"
    },
    "describe_image_detailed": {
        "system": (
            "你是一个专业的图像描述助手。"
            "请根据给定的图像内容，生成一段详细的文字描述。"
            "要求：1.详细描述图像中的主体，人物、衣着，场景、风格、色彩、光影等所有元素；"
            "2.使用丰富、准确的中文描述；"
            "3.包含环境、氛围、情绪等细节；"
            "4.适合用于文生图模型的提示词；"
            "5.只返回描述内容，不要包含任何解释或额外文字。"
        ),
        "max_tokens": 500,
        "result_key": "description",
        "description": "图像描述反推（详细）"
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