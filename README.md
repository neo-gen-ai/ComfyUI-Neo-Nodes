# ComfyUI-Neo-Nodes

一个 ComfyUI 自定义节点插件。

## 功能特性

### 1. 模型加载器

提供带目录前缀过滤功能的模型加载器节点：

- **UNetLoaderWithPrefix** - 加载扩散模型（UNet），支持目录前缀过滤
- **CheckpointLoaderWithPrefix** - 加载检查点模型，支持目录前缀过滤
- **LoraLoaderWithPrefix** - 加载 LoRA 模型，支持目录前缀过滤（仅模型参数，不包含 CLIP）

### 2. 智能提示词管理

#### NeoPrompts - 提示词管理节点

提供完整的提示词管理功能：

- **提示词保存/选择** - 保存和加载预设提示词
- **LLM 提示词增强** - 使用 AI 增强提示词质量
- **提示词翻译** - 中英互译
- **快捷生成** - 输入简短描述快速生成提示词
- **随机生成** - 一键随机生成创意提示词
- **提示词分类提取** - 自动分类提示词
- **提示词标题提取** - 自动提取提示词标题
- **智能缓存** - 本地缓存提示词

#### 节点按钮说明

| 按钮 | 功能 |
|------|------|
| ✨ Enhance | 使用 LLM 增强当前提示词 |
| 🌐 Translate | 翻译提示词（中英互译） |
| 💾 Save | 保存当前提示词为预设 |
| 📋 Select | 从预设列表加载提示词 |
| 🎲 | 随机生成创意提示词 |
| 🚀 | 根据快捷描述生成提示词 |

#### PSPrompts - AI 驱动的文本编码器

- 支持提示词保存/选择
- LLM 提示词增强
- 提示词翻译（中英互译）
- 提示词分类提取
- 提示词标题提取
- 智能缓存

### 3. 图片加载器

提供增强的图片加载功能：

- **ImageLoadWithPrefix** - 带目录前缀过滤的图片加载器

## 安装

1. 将此目录克隆或复制到 `ComfyUI/custom_nodes/` 目录
2. 重启 ComfyUI

## 依赖

- `torch`
- `huggingface_hub`（用于下载 LLM 模型）
- `llama_cpp`（用于本地 LLM 推理）

## 目录结构

```
ComfyUI-Neo-Nodes/
├── __init__.py          # 插件入口
├── prompts.py           # 提示词节点实现
├── llm.py               # LLM 推理模块
├── image_loaders.py     # 图片加载器节点
├── README.md            # 本文件
├── web/                 # 前端资源
│   ├── prompts.js       # 提示词节点前端扩展
│   ├── prompts.css      # 提示词节点样式
│   ├── prompt-manager.js # 提示词管理 UI 组件
│   ├── prompt-service.js # 提示词 API 服务
│   ├── model_loader.js  # 模型加载器前端
│   └── image_loader.js  # 图片加载器前端
├── locals/              # 本地化文件
│   └── zh_CN.json       # 中文本地化
└── prompts/             # 提示词存储目录
    └── .gitkeep
```

## 节点说明

### 模型加载器节点

#### UNetLoaderWithPrefix
- **model_directory**: 选择模型目录，`__all__` 表示显示所有模型
- **unet_name**: 要加载的扩散模型文件
- **weight_dtype**: 模型权重数据类型（default, fp8_e4m3fn, fp8_e4m3fn_fast, fp8_e5m2）

#### CheckpointLoaderWithPrefix
- **model_directory**: 选择模型目录
- **ckpt_name**: 要加载的检查点模型文件

#### LoraLoaderWithPrefix
- **model**: 要应用 LoRA 的扩散模型
- **model_directory**: 选择模型目录
- **lora_name**: LoRA 模型文件
- **strength_model**: 模型强度

### 提示词节点

#### NeoPrompts
提供完整的提示词管理 UI：
- **text**: 提示词文本（隐藏）
- **disable_text_input**: 禁用外部文本输入（隐藏）
- **text_input**: 文本输入（可选，外部连接）
- **instance_uid**: 实例 ID（隐藏）

返回类型：
- **PROMPT**: 提示词字符串


返回类型：
- **POSITIVE**: 正向条件
- **NEGATIVE**: 负向条件
- **PROMPT**: 提示词字符串


## 许可证

SPDX-License-Identifier: Apache-2.0