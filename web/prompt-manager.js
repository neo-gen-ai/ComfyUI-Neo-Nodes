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
    monitorDownloadProgress,
    getAvailableModels,
    setCurrentModel,
    checkModel,
    checkAllModels
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

function createSettingsModal() {
    const modal = mkEl("div", "rs-settings-modal");
    
    const wrapper = mkEl("div", "rs-settings-modal-wrapper");
    
    const header = mkEl("div", "rs-settings-header");
    const titleSpan = mkEl("span", "rs-settings-title-bar");
    titleSpan.textContent = "⚙️ Model Settings";
    header.appendChild(titleSpan);
    
    const closeBtn = mkEl("button", "rs-settings-close-btn");
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Close");
    header.appendChild(closeBtn);
    
    const content = mkEl("div", "rs-settings-content");
    
    const infoText = mkEl("div", "rs-settings-info");
    infoText.innerHTML = `
        <div class="rs-settings-title">Select LLM Model</div>
        <div class="rs-settings-desc">Choose the model to use for AI features</div>
    `;
    
    const modelList = mkEl("div", "rs-settings-model-list");
    
    const statusText = mkEl("div", "rs-settings-status");
    statusText.textContent = "";
    statusText.style.display = "none";
    
    content.append(infoText, modelList, statusText);
    wrapper.append(header, content);
    modal.appendChild(wrapper);
    
    return { 
        modal, 
        modelList, 
        statusText, 
        closeBtn 
    };
}

function createStatusBars() {
    const statusBar = mkEl("div", "rs-status-bar");
    statusBar.style.cssText = "width:100%;padding:4px 8px;font-size:11px;font-weight:bold;text-align:center;border-radius:4px 4px 0 0;margin-bottom:4px;display:flex;align-items:center;justify-content:center;gap:6px;line-height:1.2;position:relative;pointer-events:none;";
    
    // Toggle switch for disable_text_input (left side)
    const toggleWrapper = mkEl("div", "rs-toggle-wrapper");
    toggleWrapper.style.cssText = "position:absolute;left:4px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:4px;pointer-events:auto;";
    
    const toggleSwitch = mkEl("div", "rs-toggle-switch");
    toggleSwitch.style.cssText = "width:28px;height:16px;background:#3a3a3a;border-radius:8px;position:relative;cursor:pointer;transition:background 0.2s ease;border:1px solid #555;pointer-events:auto;";
    toggleSwitch.setAttribute("data-rs-tooltip", "Toggle external text input");
    
    const toggleKnob = mkEl("div", "rs-toggle-knob");
    toggleKnob.style.cssText = "width:12px;height:12px;background:#999;border-radius:50%;position:absolute;top:1px;left:1px;transition:transform 0.2s ease;";
    
    toggleSwitch.appendChild(toggleKnob);
    toggleWrapper.appendChild(toggleSwitch);
    
    const statusText = mkEl("span");
    statusText.textContent = "🟢 LOCAL PROMPT";
    
    const settingsBtn = mkEl("button", "rs-settings-btn");
    settingsBtn.textContent = "⚙️";
    settingsBtn.style.cssText = "background:transparent;border:none;color:#999;font-size:14px;cursor:pointer;padding:2px 6px;border-radius:3px;transition:all 0.2s ease;pointer-events:auto;";
    settingsBtn.setAttribute("data-rs-tooltip", "Model settings");
    // Note: title attribute removed to prevent ComfyUI tooltip popup
    settingsBtn.addEventListener("mouseenter", () => {
        settingsBtn.style.color = "#fff";
        settingsBtn.style.background = "rgba(80, 144, 204, 0.2)";
    });
    settingsBtn.addEventListener("mouseleave", () => {
        settingsBtn.style.color = "#999";
        settingsBtn.style.background = "transparent";
    });
    
    statusBar.appendChild(toggleWrapper);
    statusBar.appendChild(statusText);

    // 简洁输入框 - 用于输入简洁文字描述生成提示词
    const quickInputWrapper = mkEl("div", "rs-quick-input-wrapper");

    const randomBtn = mkEl("button", "rs-random-btn");
    randomBtn.textContent = "🎲";
    randomBtn.style.cssText = "padding:2px 6px;font-size:14px;background:#1a3a5a;color:#60a5fa;border:1px solid #3a6a9a;border-radius:4px 0 0 0;cursor:pointer;white-space:nowrap;height:22px;flex-shrink:0;";
    randomBtn.setAttribute("data-rs-tooltip", "Random prompt");

    const quickInput = mkEl("input", "rs-quick-input");
    quickInput.placeholder = "💡 Quick description...";

    const generateBtn = mkEl("button", "rs-generate-btn");
    generateBtn.textContent = "🚀";
    generateBtn.style.cssText = "padding:2px 6px;font-size:12px;background:linear-gradient(135deg,#2a4a6a 0%,#1a3a5a 100%);color:#60a5fa;border:1px solid #3a6a9a;border-radius:0 4px 4px 0;cursor:pointer;white-space:nowrap;height:22px;flex-shrink:0;";
    generateBtn.setAttribute("data-rs-tooltip", "Generate from description");

    quickInputWrapper.appendChild(randomBtn);
    quickInputWrapper.appendChild(quickInput);
    quickInputWrapper.appendChild(generateBtn);
    quickInputWrapper.appendChild(settingsBtn);

    const customTextarea = document.createElement("textarea");
    customTextarea.className = "comfy-multiline-input";
    customTextarea.style.cssText = "flex:1;width:100%;min-height:0;resize:none;outline:none;box-sizing:border-box;";
    customTextarea.placeholder = "Enter your prompt here...";

    const buttonsWrapper = mkEl("div", "rs-buttons-wrapper");
    const btnRow = mkEl("div", "rs-btn-row");

    const enhanceBtn = mkEl("button", "rs-btn");
    enhanceBtn.textContent = "✨ Enhance";
    enhanceBtn.setAttribute("data-rs-tooltip", "Enhance prompt with AI");
    const translateBtn = mkEl("button", "rs-btn");
    translateBtn.textContent = "🌐 Translate";
    translateBtn.setAttribute("data-rs-tooltip", "Translate prompt");
    const saveBtn = mkEl("button", "rs-btn");
    saveBtn.textContent = "💾 Save";
    saveBtn.setAttribute("data-rs-tooltip", "Save as preset");
    const selectBtn = mkEl("button", "rs-btn");
    selectBtn.textContent = "📋 Select";
    selectBtn.setAttribute("data-rs-tooltip", "Load preset");

    btnRow.append(enhanceBtn, translateBtn, saveBtn, selectBtn);
    buttonsWrapper.append(btnRow);

    return { statusBar, quickInputWrapper, randomBtn, quickInput, generateBtn, customTextarea, buttonsWrapper, enhanceBtn, translateBtn, saveBtn, selectBtn, settingsBtn, toggleSwitch, toggleKnob };
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
    const { statusBar, quickInputWrapper, randomBtn, quickInput, generateBtn, customTextarea, buttonsWrapper, enhanceBtn, translateBtn, saveBtn, selectBtn, settingsBtn, toggleSwitch, toggleKnob } = createStatusBars();
    const { overlay: presetListOverlay, searchInput: presetSearchInput, body: presetListBody } = createOverlayWithSearch("📋 Prompt Presets");
    const { modal: presetNameInput, aiStatus, field: inputField, tagsContainer, selectedTags, okBtn: inputOk, cancelBtn: inputCancel } = createInputModal();
    const { modal: deleteConfirmOverlay, textDiv: deleteText, okBtn: deleteOk, cancelBtn: deleteCancel } = createDeleteModal();
    const downloadModal = createDownloadModal();
    const settingsModal = createSettingsModal();

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
    root.appendChild(settingsModal.modal);

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

        // 绑定事件 - 使用 capture 阶段确保优先处理
        saveBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            handleSaveClick();
        }, true);
        selectBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            loadPromptList();
        }, true);

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

        // 下载进度轮询
        let downloadPollInterval = null;
        
        // 停止下载进度轮询
        function stopDownloadPolling() {
            if (downloadPollInterval) {
                clearInterval(downloadPollInterval);
                downloadPollInterval = null;
            }
        }
        
        // 开始下载进度轮询
        function startDownloadPolling() {
            stopDownloadPolling();
            downloadPollInterval = setInterval(async () => {
                try {
                    const status = await checkModel();
                    if (status.download_status?.model?.downloading) {
                        const progress = status.download_status.model.progress || 0;
                        
                        // 更新进度条
                        const progressFill = settingsModal.modelList.querySelector(".rs-download-progress-fill");
                        if (progressFill) {
                            progressFill.style.width = progress + "%";
                        }
                        
                        // 更新状态指示器显示进度
                        const statusIndicator = settingsModal.modelList.querySelector(".rs-settings-download-status");
                        if (statusIndicator) {
                            statusIndicator.textContent = `⏳ Downloading ${progress}%`;
                            statusIndicator.style.color = "#fbbf24";
                        }
                    } else {
                        // 下载完成或取消，停止轮询并刷新列表
                        stopDownloadPolling();
                        loadModelsIntoSettings();
                    }
                } catch (e) {
                    console.error("Failed to check download status:", e);
                }
            }, 500); // 每 500ms 检查一次
        }
        
        // Load models into settings modal with download status
        async function loadModelsIntoSettings() {
            try {
                stopDownloadPolling();
                const modelsData = await getAvailableModels();
                const allModelsStatus = await checkAllModels();
                const currentModelStatus = await checkModel();
                settingsModal.modelList.innerHTML = "";
                
                // 创建模型状态映射
                const modelStatusMap = {};
                allModelsStatus.models.forEach(m => {
                    modelStatusMap[m.key] = m.available;
                });
                
                modelsData.models.forEach(model => {
                    const modelItem = mkEl("div", "rs-settings-model-item");
                    const isCurrentModel = model.key === modelsData.current_model;
                    if (isCurrentModel) {
                        modelItem.classList.add("active");
                    }
                    
                    const modelInfo = mkEl("div", "rs-settings-model-info");
                    
                    // Download status
                    const isModelAvailable = modelStatusMap[model.key] || false;
                    const isDownloading = modelStatusMap[model.key] === undefined && isCurrentModel && currentModelStatus.download_status?.model?.downloading;
                    const downloadProgress = currentModelStatus.download_status?.model?.progress || 0;
                    
                    // Model name with status icon
                    const modelName = mkEl("div", "rs-settings-model-name");
                    
                    // Status icon
                    const statusIcon = mkEl("span", "rs-model-status-icon");
                    if (isDownloading) {
                        statusIcon.textContent = "⏳";
                        statusIcon.title = `Downloading ${downloadProgress}%`;
                    } else if (isModelAvailable) {
                        statusIcon.textContent = "✅";
                        statusIcon.title = "Downloaded";
                    } else {
                        statusIcon.textContent = "⬇";
                        statusIcon.title = "Not downloaded";
                    }
                    modelName.appendChild(statusIcon);
                    
                    // Name text
                    const nameText = mkEl("span");
                    nameText.textContent = model.name;
                    modelName.appendChild(nameText);
                    
                    // File size
                    const modelSize = mkEl("span", "rs-model-size");
                    modelSize.textContent = model.size || "";
                    modelName.appendChild(modelSize);
                    
                    modelInfo.appendChild(modelName);
                    
                    // 未下载的模型才显示文件名
                    if (!isModelAvailable) {
                        const modelFilename = mkEl("div", "rs-settings-model-filename");
                        modelFilename.textContent = model.filename;
                        modelInfo.appendChild(modelFilename);
                    }
                    
                    // 右侧区域
                    const rightSection = mkEl("div", "rs-settings-model-right");
                    
                    // 下载按钮（未下载时显示，无论是否当前模型）
                    if (!isModelAvailable) {
                        const downloadBtn = mkEl("button", "rs-download-btn-small");
                        downloadBtn.textContent = "⬇";
                        downloadBtn.title = "Download this model";
                        downloadBtn.addEventListener("click", async (e) => {
                            e.stopPropagation();
                            downloadBtn.disabled = true;
                            downloadBtn.textContent = "⏳";
                            
                            // 如果不是当前模型，先切换
                            if (!isCurrentModel) {
                                const switchResult = await setCurrentModel(model.key);
                                if (!switchResult.success) {
                                    downloadBtn.disabled = false;
                                    downloadBtn.textContent = "⬇";
                                    settingsModal.statusText.style.display = "block";
                                    settingsModal.statusText.textContent = "Switch failed: " + (switchResult.error || "Unknown error");
                                    settingsModal.statusText.className = "rs-settings-status";
                                    return;
                                }
                            }
                            
                            // 开始下载
                            const downloadResult = await downloadModel("model");
                            if (downloadResult.error) {
                                downloadBtn.disabled = false;
                                downloadBtn.textContent = "⬇";
                                settingsModal.statusText.style.display = "block";
                                settingsModal.statusText.textContent = "Download failed: " + downloadResult.error;
                                settingsModal.statusText.className = "rs-settings-status";
                            } else {
                                // 显示进度条并开始轮询
                                const progressBar = mkEl("div", "rs-download-progress-bar");
                                const progressFill = mkEl("div", "rs-download-progress-fill");
                                progressFill.style.width = "0%";
                                progressBar.appendChild(progressFill);
                                
                                const progressText = mkEl("div", "rs-download-progress-text");
                                progressText.textContent = "Starting download...";
                                
                                modelItem.appendChild(progressBar);
                                modelItem.appendChild(progressText);
                                
                                startDownloadPolling();
                            }
                        });
                        rightSection.appendChild(downloadBtn);
                    }
                    
                    // 切换指示器
                    const indicator = mkEl("div", "rs-settings-model-check");
                    indicator.textContent = "✓";
                    rightSection.appendChild(indicator);
                    
                    modelItem.appendChild(modelInfo);
                    modelItem.appendChild(rightSection);
                    
                    modelItem.addEventListener("click", async () => {
                        if (model.key === modelsData.current_model) return;
                        
                        settingsModal.statusText.style.display = "block";
                        settingsModal.statusText.textContent = "Switching model...";
                        settingsModal.statusText.className = "rs-settings-status";
                        
                        const result = await setCurrentModel(model.key);
                        
                        if (result.success) {
                            settingsModal.statusText.textContent = "Model switched successfully!";
                            settingsModal.statusText.className = "rs-settings-status success";
                            
                            // 重新加载模型列表以更新状态
                            loadModelsIntoSettings();
                            
                            setTimeout(() => {
                                settingsModal.statusText.style.display = "none";
                            }, 1000);
                        } else {
                            settingsModal.statusText.textContent = "Failed to switch model: " + (result.error || "Unknown error");
                            settingsModal.statusText.className = "rs-settings-status";
                        }
                    });
                    
                    settingsModal.modelList.appendChild(modelItem);
                });
            } catch (e) {
                console.error("Failed to load models:", e);
                settingsModal.modelList.textContent = "Failed to load models";
            }
        }

        settingsBtn.addEventListener("click", () => {
            settingsModal.modal.style.display = "flex";
            loadModelsIntoSettings();
        });
        
        // 绑定设置模态框关闭按钮点击事件
        settingsModal.closeBtn.addEventListener("click", () => {
            settingsModal.modal.style.display = "none";
        });
        
        // 点击模态框背景关闭
        settingsModal.modal.addEventListener("click", (e) => {
            if (e.target === settingsModal.modal) {
                settingsModal.modal.style.display = "none";
            }
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
            settingsBtn,
            toggleSwitch,
            toggleKnob,
            // 按钮行中的操作按钮（供 createPopupCloser 使用）
            saveBtn,
            selectBtn,
            // 返回模态框元素供外部管理
            presetListOverlay,
            presetNameInput,
            deleteConfirmOverlay,
            // 返回下载模态框元素
            downloadModal,
            // 返回设置模态框元素
            settingsModal,
            loadModelsIntoSettings
        };
    }

    return {
        root,
        init
    };
}

export {
    mkEl,
    createPromptManagerUI,
    createSettingsModal
};
