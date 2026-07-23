/**
 * prompt-service.js
 * API 调用和数据处理模块
 */

// ==========================================
// API 服务
// ==========================================

/**
 * 增强提示词
 * @param {string} text - 原始提示词
 * @returns {Promise<{status: string, enhanced: string, error?: string}>}
 */
async function enhancePrompt(text) {
    const res = await fetch("/rs_prompts/enhance_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
    });
    return await res.json();
}

/**
 * 翻译提示词
 * @param {string} text - 原始提示词
 * @returns {Promise<{status: string, translated: string, error?: string}>}
 */
async function translatePrompt(text) {
    const res = await fetch("/rs_prompts/translate_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
    });
    return await res.json();
}

/**
 * 保存提示词
 * @param {string} name - 提示词名称
 * @param {string} text - 提示词内容
 * @param {string[]} tags - 标签列表
 * @returns {Promise<Response>}
 */
async function savePrompt(name, text, tags = []) {
    return await fetch("/rs_prompts/save_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, text, tags })
    });
}

/**
 * 加载提示词
 * @param {string} name - 提示词名称
 * @returns {Promise<{text: string}>}
 */
async function loadPrompt(name) {
    const res = await fetch("/rs_prompts/load_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    });
    return await res.json();
}

/**
 * 列出所有提示词
 * @returns {Promise<Array<{name: string, tags: string[]}|string>}
 */
async function listPrompts() {
    const res = await fetch("/rs_prompts/list_prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });
    return await res.json();
}

/**
 * 删除提示词
 * @param {string} name - 提示词名称
 * @returns {Promise<Response>}
 */
async function deletePrompt(name) {
    return await fetch("/rs_prompts/delete_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    });
}

/**
 * 提取标题
 * @param {string} text - 提示词内容
 * @returns {Promise<{status: string, title: string, error?: string}>}
 */
async function extractTitle(text) {
    const res = await fetch("/rs_prompts/extract_title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
    });
    return await res.json();
}

/**
 * 提取分类
 * @param {string} text - 提示词内容
 * @returns {Promise<{status: string, classify: string, error?: string}>}
 */
async function extractClassify(text) {
    const res = await fetch("/rs_prompts/extract_classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
    });
    return await res.json();
}

/**
 * 从简洁文字生成文生图提示词
 * @param {string} text - 简洁的文字描述
 * @returns {Promise<{status: string, prompt: string, error?: string}>}
 */
async function generatePromptFromText(text) {
    const res = await fetch("/rs_prompts/generate_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
    });
    return await res.json();
}

/**
 * 随机生成文生图提示词
 * @returns {Promise<{status: string, prompt: string, error?: string}>}
 */
async function randomPrompt() {
    const res = await fetch("/rs_prompts/random_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "random" })
    });
    return await res.json();
}

// ==========================================
// 导出
// ==========================================

export {
    enhancePrompt,
    translatePrompt,
    savePrompt,
    loadPrompt,
    listPrompts,
    deletePrompt,
    extractTitle,
    extractClassify,
    generatePromptFromText,
    randomPrompt
};