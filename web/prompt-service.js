/**
 * prompt-service.js
 * API 调用和数据处理模块
 */

// ==========================================
// 模型状态缓存
// ==========================================
let modelStatusCache = null;
let modelStatusCacheTime = 0;
const MODEL_STATUS_CACHE_TTL = 5000; // 5秒缓存，下载时频繁检查

/**
 * 检查 LLM 模型是否已下载
 * @returns {Promise<{model_available: boolean, mmproj_available: boolean, model_repo_id: string, model_filename: string, download_status: object}>}
 */
async function checkModel() {
    // 使用缓存减少请求
    const now = Date.now();
    if (modelStatusCache && (now - modelStatusCacheTime) < MODEL_STATUS_CACHE_TTL) {
        return modelStatusCache;
    }

    try {
        const res = await fetch("/rs_prompts/check_model");
        modelStatusCache = await res.json();
        modelStatusCacheTime = now;
        return modelStatusCache;
    } catch (e) {
        console.error("Failed to check model status:", e);
        return {
            model_available: false,
            mmproj_available: false,
            download_status: {
                model: { downloading: false, progress: 0, error: null },
                mmproj: { downloading: false, progress: 0, error: null }
            }
        };
    }
}

/**
 * 启动模型下载
 * @param {string} fileType - "model" 或 "mmproj"
 * @returns {Promise<{status: string}>}
 */
async function downloadModel(fileType) {
    try {
        const res = await fetch("/rs_prompts/download_model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_type: fileType })
        });
        return await res.json();
    } catch (e) {
        console.error("Failed to start download:", e);
        return { error: e.message };
    }
}

/**
 * 检查模型并自动下载（如果未下载）
 * 下载在后台进行，不阻塞前端
 * @param {Object} downloadModal - 下载模态框引用
 * @param {Object} statusBar - 状态栏引用（可选）
 * @returns {Promise<boolean>} - 返回 true 表示可以继续操作，false 表示模型未就绪
 */
async function checkModelAndPrompt(downloadModal = null, statusBar = null) {
    const status = await checkModel();

    if (!status.model_available) {
        // 检查是否正在下载
        const downloadStatus = status.download_status?.model;

        if (downloadStatus && downloadStatus.downloading) {
            // 正在下载，提示用户等待
            if (downloadModal) {
                showDownloadModal(downloadModal, status, true, null, statusBar);
            } else {
                alert(`⏳ 模型正在后台下载中... (${downloadStatus.progress || 0}%)
                
请在下载完成后重试此操作。`);
            }
            return false;
        }

        // 检查是否有下载错误
        if (downloadStatus && downloadStatus.error) {
            if (downloadModal) {
                showDownloadModal(downloadModal, status, false, downloadStatus.error, statusBar);
            } else {
                alert("下载失败: " + downloadStatus.error + "\n\n请重试或手动下载模型。");
            }
            return false;
        }

        // 显示下载模态框
        if (downloadModal) {
            showDownloadModal(downloadModal, status, false, null, statusBar);
            return false;
        }

        // 询问用户是否下载
        const msg = [
            "⚠️ LLM 模型未下载",
            "",
            "需要下载以下模型文件：",
            `📦 ${status.model_filename || "Qwen3.5-0.8B-Q4_K_M.gguf"}`,
            "",
            `从 HuggingFace 仓库：`,
            `🔗 ${status.model_repo_id || "lmstudio-community/Qwen3.5-0.8B-GGUF"}`,
            "",
            "是否现在启动后台下载？\n（下载将在后台进行，下载完成后请重试此操作）"
        ].join("\n");

        if (!confirm(msg)) {
            return false;
        }

        // 启动下载（非阻塞）
        const result = await downloadModel("model");
        if (result.error) {
            alert("启动下载失败: " + result.error);
            return false;
        }

        // 提示用户下载已启动
        alert("✅ 下载已启动！\n\n模型将在后台下载，下载完成后请重试此操作。\n\n您可以在控制台查看下载进度。");

        // 开始后台进度监控（不阻塞）
        monitorDownloadProgress();

        return false; // 返回 false，让用户知道需要重试
    }

    return true;
}

/**
 * 显示下载模态框
 * @param {Object} downloadModal - 下载模态框引用
 * @param {Object} status - 模型状态
 * @param {boolean} isDownloading - 是否正在下载
 * @param {string} error - 错误信息
 * @param {Object} statusBar - 状态栏引用（可选）
 */
function showDownloadModal(downloadModal, status, isDownloading = false, error = null, statusBar = null) {
    const { modal, modelInfo, progressContainer, progressFill, progressText, statusText, downloadBtn, cancelBtn, closeBtn } = downloadModal;
    
    // 更新模型信息
    const modelName = status.model_filename || "Qwen3.5-0.8B-Q4_K_M.gguf";
    const repoId = status.model_repo_id || "lmstudio-community/Qwen3.5-0.8B-GGUF";
    modelInfo.innerHTML = `
        <div class="rs-download-model-name">${modelName}</div>
        <div class="rs-download-repo">${repoId}</div>
    `;
    
    if (isDownloading) {
        // 正在下载状态
        progressContainer.style.display = "block";
        const progress = status.download_status?.model?.progress || 0;
        progressFill.style.width = `${progress}%`;
        progressText.textContent = `${progress}%`;
        statusText.textContent = "Downloading in progress...";
        downloadBtn.style.display = "none";
        cancelBtn.style.display = "none";
        closeBtn.style.display = "block";
        modal.style.display = "block";
        
        // 更新状态栏
        if (statusBar) {
            statusBar.classList.add("rs-status-downloading");
            statusBar.innerHTML = `⏳ Downloading ${progress}%`;
        }
        
        // 开始监控进度
        monitorDownloadProgress(downloadModal, statusBar);
    } else if (error) {
        // 错误状态
        progressContainer.style.display = "none";
        statusText.textContent = "Download failed: " + error;
        statusText.style.color = "#f87171";
        downloadBtn.style.display = "block";
        downloadBtn.textContent = "🔄 Retry Download";
        cancelBtn.style.display = "block";
        closeBtn.style.display = "none";
        modal.style.display = "block";
        
        // 恢复状态栏
        if (statusBar) {
            statusBar.classList.remove("rs-status-downloading");
        }
    } else {
        // 初始状态
        progressContainer.style.display = "none";
        statusText.textContent = "Ready to download";
        statusText.style.color = "#999";
        downloadBtn.style.display = "block";
        downloadBtn.textContent = "🚀 Start Download";
        cancelBtn.style.display = "block";
        closeBtn.style.display = "none";
        modal.style.display = "block";
        
        // 恢复状态栏
        if (statusBar) {
            statusBar.classList.remove("rs-status-downloading");
        }
    }
}

/**
 * 后台监控下载进度（不阻塞）
 */
let downloadMonitorInterval = null;

function monitorDownloadProgress(downloadModal = null, statusBar = null) {
    if (downloadMonitorInterval) {
        return; // 已经在监控
    }

    downloadMonitorInterval = setInterval(async () => {
        const status = await checkModel();
        const downloadStatus = status.download_status?.model;

        if (!downloadStatus || !downloadStatus.downloading) {
            // 下载完成或失败，停止监控
            clearInterval(downloadMonitorInterval);
            downloadMonitorInterval = null;

            if (status.model_available) {
                console.log("✅ 模型下载完成！");
                if (downloadModal) {
                    const { modal, progressContainer, progressFill, progressText, statusText, downloadBtn, cancelBtn, closeBtn } = downloadModal;
                    progressFill.style.width = "100%";
                    progressText.textContent = "100%";
                    statusText.textContent = "Download completed successfully!";
                    statusText.style.color = "#4ade80";
                    downloadBtn.style.display = "none";
                    cancelBtn.style.display = "none";
                    closeBtn.style.display = "block";
                    closeBtn.textContent = "✓ Done";
                    
                    // 恢复状态栏
                    if (statusBar) {
                        statusBar.classList.remove("rs-status-downloading");
                        statusBar.innerHTML = "🟢 LOCAL PROMPT";
                    }
                    
                    // 3秒后自动关闭
                    setTimeout(() => {
                        modal.style.display = "none";
                    }, 3000);
                }
            } else if (downloadStatus && downloadStatus.error) {
                console.error("❌ 模型下载失败:", downloadStatus.error);
                if (downloadModal) {
                    const { modal, progressContainer, progressFill, progressText, statusText, downloadBtn, cancelBtn, closeBtn } = downloadModal;
                    progressContainer.style.display = "none";
                    statusText.textContent = "Download failed: " + downloadStatus.error;
                    statusText.style.color = "#f87171";
                    downloadBtn.style.display = "block";
                    downloadBtn.textContent = "🔄 Retry Download";
                    cancelBtn.style.display = "block";
                    closeBtn.style.display = "none";
                    
                    // 恢复状态栏
                    if (statusBar) {
                        statusBar.classList.remove("rs-status-downloading");
                    }
                }
            }
        } else {
            const progress = downloadStatus.progress || 0;
            console.log(`⏳ 模型下载进度: ${progress}%`);
            if (downloadModal) {
                const { progressFill, progressText, statusText } = downloadModal;
                progressFill.style.width = `${progress}%`;
                progressText.textContent = `${progress}%`;
                statusText.textContent = "Downloading in progress...";
            }
            // 更新状态栏
            if (statusBar) {
                statusBar.classList.add("rs-status-downloading");
                statusBar.innerHTML = `⏳ Downloading ${progress}%`;
            }
        }
    }, 2000); // 每 2 秒检查一次
}

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
    checkModel,
    downloadModel,
    checkModelAndPrompt,
    showDownloadModal,
    monitorDownloadProgress,
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
