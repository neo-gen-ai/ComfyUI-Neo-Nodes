/**
 * prompt-manager.js
 * 提示词管理模块 - UI 组件创建 + 保存、列表、加载、删除
 */

import {
    savePrompt,
    loadPrompt,
    listPrompts,
    deletePrompt,
    extractTitle,
    extractClassify,
    generatePromptFromText,
    randomPrompt as randomPromptAPI,
    downloadModel,
    monitorDownloadProgress
} from "./prompt-service.js";

// ==========================================
// DOM 元素工厂
// ==========================================

function mkEl(tag, className, styles = '') {
    const el = document.createElement(tag);
    if (className) {
        el.className = className;
    }
    if (styles) {
        el.style.cssText = styles;
    }
    return el;
}

// ==========================================
// UI 组件创建 (内部使用)
// ==========================================

function createOverlayWithSearch(title) {
    const overlay = mkEl("div", "rs-preset-list-overlay");
    const header = mkEl("div", "rs-preset-list-header");
    const titleSpan = mkEl("span", "rs-preset-list-title");
    titleSpan.textContent = title;
    header.appendChild(titleSpan);

    const searchInput = mkEl("input", "rs-preset-search-input");
    searchInput.placeholder = "🔍 Search presets...";

    const body = mkEl("div", "rs-preset-list-body");

    overlay.appendChild(header);
    overlay.appendChild(searchInput);
    overlay.appendChild(body);

    const closeBtn = mkEl("button", "rs-close-btn top-right");
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.style.cssText = "position:absolute;top:8px;right:8px;padding:4px 10px;font-size:12px;background:linear-gradient(135deg,#1a2a2a 0%,#2a3a3a 100%);color:#ccc;border:1px solid #444;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10;";

    closeBtn.addEventListener("click", () => {
        overlay.style.display = "none";
    });

    return { overlay, header, searchInput, body, closeBtn };
}

function createInputModal() {
    const modal = mkEl("div", "rs-preset-name-input");
    const aiStatus = mkEl("div", "rs-ai-status processing");
    aiStatus.innerHTML = "⏳ AI 正在分析提示词...";

    const label = mkEl("div", "rs-input-label");
    label.textContent = "Prompt name:";

    const inputWrapper = mkEl("div", "rs-input-wrapper");
    const field = mkEl("input", "rs-input-field");
    field.placeholder = "Enter preset name...";
    inputWrapper.appendChild(field);

    const tagsLabel = mkEl("div", "rs-input-label");
    tagsLabel.textContent = "Tags (optional):";

    const tagsContainer = mkEl("div", "rs-tags-container");
    const tagList = ["唯美", "特色", "写实", "古风", "动漫", "油画", "室内", "户外"];
    const selectedTags = new Set();

    tagList.forEach(tag => {
        const tagBtn = mkEl("button", "rs-tag-btn");
        tagBtn.textContent = tag;
        tagBtn.addEventListener("click", () => {
            if (selectedTags.has(tag)) {
                selectedTags.delete(tag);
                tagBtn.classList.remove("rs-tag-selected");
            } else {
                selectedTags.add(tag);
                tagBtn.classList.add("rs-tag-selected");
            }
        });
        tagsContainer.appendChild(tagBtn);
    });

    const btnsDiv = mkEl("div", "rs-input-buttons");
    const okBtn = mkEl("button", "rs-input-ok-btn");
    okBtn.textContent = "OK";
    const cancelBtn = mkEl("button", "rs-input-cancel-btn");
    cancelBtn.textContent = "Cancel";
    btnsDiv.append(okBtn, cancelBtn);
    modal.append(aiStatus, label, inputWrapper, tagsLabel, tagsContainer, btnsDiv);

    return { modal, aiStatus, label, field, inputWrapper, tagsContainer, okBtn, cancelBtn, selectedTags };
}

function createDeleteModal() {
    const modal = mkEl("div", "rs-delete-confirm-overlay");
    const textDiv = mkEl("div", "rs-delete-text");
    const btnsDiv = mkEl("div", "rs-delete-buttons");
    const okBtn = mkEl("button", "rs-delete-ok-btn");
    okBtn.textContent = "OK";
    const cancelBtn = mkEl("button", "rs-delete-cancel-btn");
    cancelBtn.textContent = "Cancel";
    btnsDiv.append(okBtn, cancelBtn);
    modal.append(textDiv, btnsDiv);
    return { modal, textDiv, okBtn, cancelBtn };
}

function createDownloadModal() {
    const modal = mkEl("div", "rs-download-modal");
    
    const header = mkEl("div", "rs-download-header");
    header.innerHTML = "📦 Model Download";
    
    const content = mkEl("div", "rs-download-content");
    
    const infoText = mkEl("div", "rs-download-info");
    infoText.innerHTML = `
        <div class="rs-download-title">LLM Model Required</div>
        <div class="rs-download-desc">Download the model to enable AI features</div>
    `;
    
    const modelInfo = mkEl("div", "rs-download-model-info");
    modelInfo.innerHTML = `
        <div class="rs-download-model-name">Qwen3.5-0.8B-Q4_K_M.gguf</div>
        <div class="rs-download-repo">lmstudio-community/Qwen3.5-0.8B-GGUF</div>
    `;
    
    const progressContainer = mkEl("div", "rs-download-progress-container");
    progressContainer.style.display = "none";
    
    const progressBar = mkEl("div", "rs-download-progress-bar");
    const progressFill = mkEl("div", "rs-download-progress-fill");
    const progressText = mkEl("div", "rs-download-progress-text");
    progressText.textContent = "0%";
    
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(progressText);
    
    const statusText = mkEl("div", "rs-download-status");
    statusText.textContent = "Ready to download";
    
    const btnsDiv = mkEl("div", "rs-download-buttons");
    const downloadBtn = mkEl("button", "rs-download-btn");
    downloadBtn.textContent = "🚀 Start Download";
    const cancelBtn = mkEl("button", "rs-download-cancel-btn");
    cancelBtn.textContent = "Cancel";
    const closeBtn = mkEl("button", "rs-download-close-btn");
    closeBtn.textContent = "✕";
    closeBtn.style.display = "none";
    
    btnsDiv.append(downloadBtn, cancelBtn, closeBtn);
    
    content.append(infoText, modelInfo, progressContainer, statusText, btnsDiv);
    modal.append(header, content);
    
    return { 
        modal, 
        infoText, 
        modelInfo, 
        progressContainer, 
        progressFill, 
        progressText, 
        statusText, 
        downloadBtn, 
        cancelBtn, 
        closeBtn 
    };
}

function createStatusBars() {
    const statusBar = mkEl("div", "rs-status-bar-local");
    statusBar.style.cssText = "width:100%;padding:4px 8px;font-size:11px;font-weight:bold;text-align:center;border-radius:4px 4px 0 0;margin-bottom:4px;display:flex;align-items:center;justify-content:center;gap:6px;line-height:1.2;";
    statusBar.innerHTML = "🟢 LOCAL PROMPT";

    // 简洁输入框 - 用于输入简洁文字描述生成提示词
    const quickInputWrapper = mkEl("div", "rs-quick-input-wrapper");

    const randomBtn = mkEl("button", "rs-random-btn");
    randomBtn.textContent = "🎲";
    randomBtn.style.cssText = "padding:2px 6px;font-size:14px;background:linear-gradient(135deg,#5a2a6a 0%,#4a1a5a 100%);color:#d8a0ff;border:1px solid #7a4a9a;border-radius:4px 0 0 0;cursor:pointer;white-space:nowrap;height:22px;flex-shrink:0;";

    const quickInput = mkEl("input", "rs-quick-input");
    quickInput.placeholder = "💡 Quick description...";

    const generateBtn = mkEl("button", "rs-generate-btn");
    generateBtn.textContent = "🚀";
    generateBtn.style.cssText = "padding:2px 6px;font-size:12px;background:linear-gradient(135deg,#2a4a6a 0%,#1a3a5a 100%);color:#60a5fa;border:1px solid #3a6a9a;border-radius:0 4px 4px 0;cursor:pointer;white-space:nowrap;height:22px;flex-shrink:0;";

    quickInputWrapper.appendChild(randomBtn);
    quickInputWrapper.appendChild(quickInput);
    quickInputWrapper.appendChild(generateBtn);

    const customTextarea = document.createElement("textarea");
    customTextarea.className = "comfy-multiline-input";
    customTextarea.style.cssText = "flex:1;width:100%;min-height:0;resize:none;outline:none;box-sizing:border-box;";
    customTextarea.placeholder = "Enter your prompt here...";

    const buttonsWrapper = mkEl("div", "rs-buttons-wrapper");
    const btnRow = mkEl("div", "rs-btn-row");

    const enhanceBtn = mkEl("button", "rs-btn");
    enhanceBtn.textContent = "✨ Enhance";
    const translateBtn = mkEl("button", "rs-btn");
    translateBtn.textContent = "🌐 Translate";
    const saveBtn = mkEl("button", "rs-btn");
    saveBtn.textContent = "💾 Save";
    const selectBtn = mkEl("button", "rs-btn");
    selectBtn.textContent = "📋 Select";

    btnRow.append(enhanceBtn, translateBtn, saveBtn, selectBtn);
    buttonsWrapper.append(btnRow);

    return { statusBar, quickInputWrapper, randomBtn, quickInput, generateBtn, customTextarea, buttonsWrapper, enhanceBtn, translateBtn, saveBtn, selectBtn };
}

// ==========================================
// 提示词管理器工厂
// ==========================================

/**
 * 创建提示词管理 UI
 * @returns {Object} - 包含 root 容器和 init 方法
 */
function createPromptManagerUI() {
    // 创建所有 UI 组件
    const { statusBar, quickInputWrapper, randomBtn, quickInput, generateBtn, customTextarea, buttonsWrapper, enhanceBtn, translateBtn, saveBtn, selectBtn } = createStatusBars();
    const { overlay: presetListOverlay, searchInput: presetSearchInput, body: presetListBody } = createOverlayWithSearch("📋 Prompt Presets");
    const { modal: presetNameInput, aiStatus, field: inputField, tagsContainer, selectedTags, okBtn: inputOk, cancelBtn: inputCancel } = createInputModal();
    const { modal: deleteConfirmOverlay, textDiv: deleteText, okBtn: deleteOk, cancelBtn: deleteCancel } = createDeleteModal();
    const downloadModal = createDownloadModal();

    // 创建 root 容器
    const root = mkEl("div", "rs-root");
    root.appendChild(statusBar);
    root.appendChild(quickInputWrapper);
    root.appendChild(customTextarea);
    root.appendChild(buttonsWrapper);

    // 将模态框也添加到 root 中
    root.appendChild(presetListOverlay);
    root.appendChild(presetNameInput);
    root.appendChild(deleteConfirmOverlay);
    root.appendChild(downloadModal.modal);

    // 配置 preset list body 样式
    presetListBody.style.scrollbarWidth = "thin";
    presetListBody.style.scrollbarColor = "#5090cc #1a1a1a";

    // 内部状态
    let pendingDeleteName = null;
    let filterTimeout = null;
    let context = null;

    /**
     * 初始化提示词管理器
     * @param {Object} ctx - 上下文 (node, graph, textWidget)
     * @returns {Object} - 返回增强/翻译按钮和 customTextarea 引用
     */
    function init(ctx) {
        context = ctx;
        const { node, graph, textWidget } = ctx;

        // 保存按钮点击处理
        function handleSaveClick() {
            presetListOverlay.style.display = "none";
            deleteConfirmOverlay.style.display = "none";
            presetNameInput.style.display = "block";
            inputField.value = "";
            setTimeout(() => inputField.focus(), 50);

            selectedTags.clear();
            const tagButtons = tagsContainer.querySelectorAll(".rs-tag-btn");
            tagButtons.forEach(btn => {
                btn.classList.remove("rs-tag-selected");
            });

            const currentText = textWidget?.value || "";

            if (currentText.trim()) {
                saveBtn.disabled = true;
                aiStatus.className = "rs-ai-status processing";
                aiStatus.innerHTML = "⏳ AI 正在分析提示词...";

                Promise.all([
                    extractTitle(currentText),
                    extractClassify(currentText)
                ]).then(([dataTitle, dataClassify]) => {
                    if (dataTitle.status === "success") {
                        inputField.value = dataTitle.title;
                    }

                    if (dataClassify.status === "success" && dataClassify.classify) {
                        const classifyText = dataClassify.classify.trim();
                        console.log("📊 Auto-classification result:", classifyText);

                        const classifyList = classifyText.split(/[,，]/).map(s => s.trim()).filter(s => s);
                        console.log("🏷️ Classify list:", classifyList);

                        tagButtons.forEach(btn => {
                            const btnText = btn.textContent.trim();
                            if (classifyList.includes(btnText)) {
                                selectedTags.add(btnText);
                                btn.classList.add("rs-tag-selected");
                            }
                        });
                        aiStatus.className = "rs-ai-status success";
                        aiStatus.innerHTML = "✅ AI 分析完成";
                    } else {
                        console.log("⚠️ Auto-classify failed, using manual selection.");
                        aiStatus.className = "rs-ai-status error";
                        aiStatus.innerHTML = "❌ AI 分析失败，请手动填写";
                    }
                }).catch(e => {
                    console.error("Auto-extract error:", e);
                }).finally(() => {
                    saveBtn.disabled = false;
                });
            }
        }

        // 执行保存
        function performSave() {
            const name = inputField.value.trim();
            if (!name) return;
            presetNameInput.style.display = "none";
            const tags = Array.from(selectedTags);
            console.log("Tags:", tags);
            savePrompt(name, textWidget ? textWidget.value : "", tags);
        }

        // 搜索过滤
        function filterPresets(query) {
            const items = presetListBody.querySelectorAll(".rs-preset-item");

            if (!query) {
                items.forEach(item => {
                    item.classList.remove("hidden");
                    const contentSpan = item.querySelector(".rs-preset-content");
                    if (contentSpan) {
                        const originalText = item.dataset.original;
                        if (originalText) {
                            contentSpan.innerHTML = "";
                            contentSpan.textContent = originalText;
                        }
                    }
                });
                return;
            }

            items.forEach(item => {
                const contentSpan = item.querySelector(".rs-preset-content");
                if (!contentSpan) return;

                const fullText = contentSpan.textContent.toLowerCase();

                if (fullText.includes(query)) {
                    item.classList.remove("hidden");
                    const regex = new RegExp(`(${query})`, "gi");
                    const highlightedText = fullText.replace(regex, '<span class="rs-match-highlight">$1</span>');
                    contentSpan.innerHTML = highlightedText;
                } else {
                    item.classList.add("hidden");
                }
            });
        }

        // 加载提示词列表
        async function loadPromptList() {
            presetNameInput.style.display = "none";
            deleteConfirmOverlay.style.display = "none";
            presetListBody.innerHTML = "";
            presetListOverlay.style.display = "flex";

            const loadingDiv = mkEl("div", "");
            loadingDiv.style.cssText = "display:flex;align-items:center;justify-content:center;padding:20px;color:#999;font-size:12px;";
            loadingDiv.textContent = "Loading...";
            presetListBody.appendChild(loadingDiv);

            try {
                const list = await listPrompts();

                if (loadingDiv.parentNode) loadingDiv.remove();

                if (!list.length) {
                    presetListBody.textContent = "No presets found";
                    return;
                }

                setTimeout(() => {
                    presetSearchInput.focus();
                }, 100);

                list.forEach(item => {
                    const name = typeof item === 'string' ? item : item.name;
                    const tags = typeof item === 'string' ? [] : (item.tags || []);

                    const row = document.createElement("div");
                    row.className = "rs-preset-item";
                    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #333;";
                    row.dataset.name = name;

                    const leftDiv = mkEl("div", "");
                    leftDiv.style.cssText = "display:flex;align-items:center;flex:1;";

                    const contentSpan = mkEl("span", "rs-preset-content");
                    const displayText = tags && tags.length > 0 ? `${name} [${tags.join(", ")}]` : name;

                    if (tags && tags.length > 0) {
                        contentSpan.textContent = name;
                        const tagsSpan = document.createElement("span");
                        tagsSpan.className = "rs-tags-part";
                        tagsSpan.textContent = ` [${tags.join(", ")}]`;
                        contentSpan.appendChild(document.createTextNode(" "));
                        contentSpan.appendChild(tagsSpan);
                    } else {
                        contentSpan.textContent = name;
                    }

                    contentSpan.dataset.original = displayText;
                    row.dataset.original = displayText;
                    leftDiv.appendChild(contentSpan);
                    row.appendChild(leftDiv);

                    row.onclick = async (e) => {
                        if (e.target.closest(".rs-preset-delete-btn")) return;

                        console.log("✅ Clicked preset:", name);
                        const data = await loadPrompt(name);

                        if (textWidget) {
                            textWidget.value = data.text || "";
                        }
                        if (customTextarea) {
                            customTextarea.value = data.text || "";
                        }

                        const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                        const currentTextKey = `rs_prompt_${currentUid}`;
                        localStorage.setItem(currentTextKey, data.text || "");

                        presetListOverlay.style.display = "none";
                        if (graph) graph.setDirtyCanvas(true, true);
                    };

                    const deleteBtn = mkEl("span", "rs-preset-delete-btn");
                    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
                    deleteBtn.style.cssText = "cursor:pointer;margin-left:8px;font-size:16px;opacity:0.7;background:transparent;color:#f87171;border:none;padding:2px 6px;display:inline-flex;align-items:center;justify-content:center;gap:4px;";
                    deleteBtn.setAttribute("aria-label", "Delete preset");
                    deleteBtn.onclick = async (e) => {
                        e.stopPropagation();
                        pendingDeleteName = name;
                        deleteText.textContent = `Delete "${name}"?`;
                        deleteConfirmOverlay.style.display = "block";
                    };
                    row.appendChild(deleteBtn);

                    presetListBody.appendChild(row);
                });
            } catch (e) {
                presetListBody.textContent = "Error loading";
            }
        }

        // 绑定事件
        saveBtn.addEventListener("click", handleSaveClick);
        selectBtn.addEventListener("click", loadPromptList);

        inputOk.addEventListener("click", performSave);
        inputCancel.addEventListener("click", () => {
            presetNameInput.style.display = "none";
        });
        inputField.addEventListener("keydown", (e) => {
            if (e.key === "Enter") performSave();
            if (e.key === "Escape") presetNameInput.style.display = "none";
        });

        presetSearchInput.addEventListener("input", () => {
            const query = presetSearchInput.value.trim().toLowerCase();
            if (filterTimeout) clearTimeout(filterTimeout);
            filterTimeout = setTimeout(() => {
                filterPresets(query);
            }, 150);
        });

        deleteOk.addEventListener("click", async () => {
            if (pendingDeleteName) {
                await deletePrompt(pendingDeleteName);
                deleteConfirmOverlay.style.display = "none";
                selectBtn.click();
                pendingDeleteName = null;
            }
        });

        deleteCancel.addEventListener("click", () => {
            deleteConfirmOverlay.style.display = "none";
            pendingDeleteName = null;
        });

        // Download modal button handlers
        downloadModal.downloadBtn.addEventListener("click", async () => {
            downloadModal.downloadBtn.disabled = true;
            downloadModal.downloadBtn.textContent = "⏳ Starting...";
            
            const result = await downloadModel("model");
            if (result.error) {
                downloadModal.statusText.textContent = "Failed to start download: " + result.error;
                downloadModal.statusText.style.color = "#f87171";
                downloadModal.downloadBtn.disabled = false;
                downloadModal.downloadBtn.textContent = "🔄 Retry Download";
                return;
            }
            
            // Show progress
            downloadModal.progressContainer.style.display = "block";
            downloadModal.downloadBtn.style.display = "none";
            downloadModal.cancelBtn.style.display = "none";
            downloadModal.closeBtn.style.display = "none";
            downloadModal.statusText.textContent = "Download started...";
            downloadModal.statusText.style.color = "#999";
            
            // Start monitoring
            monitorDownloadProgress(downloadModal, statusBar);
        });

        downloadModal.cancelBtn.addEventListener("click", () => {
            downloadModal.modal.style.display = "none";
        });

        downloadModal.closeBtn.addEventListener("click", () => {
            downloadModal.modal.style.display = "none";
        });

        // 返回需要外部引用的元素
        return {
            enhanceBtn,
            translateBtn,
            generateBtn,
            randomBtn,
            quickInput,
            customTextarea,
            statusBar,
            // 返回模态框元素供外部管理
            presetListOverlay,
            presetNameInput,
            deleteConfirmOverlay,
            // 返回下载模态框元素
            downloadModal
        };
    }

    return {
        root,
        init
    };
}

export {
    mkEl,
    createPromptManagerUI
};