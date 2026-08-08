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

function createOverlayWithSearch() {
    const overlay = mkEl("div", "rs-preset-list-overlay");
    const body = mkEl("div", "rs-preset-list-body");
    overlay.appendChild(body);
    return { overlay, body };
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
    // 遮罩层 - 真正的模态窗口需要
    const overlay = mkEl("div", "rs-settings-overlay");
    
    const modal = mkEl("div", "rs-settings-modal");
    
    const wrapper = mkEl("div", "rs-settings-modal-wrapper");
    
    const header = mkEl("div", "rs-settings-header");
    const titleSpan = mkEl("span", "rs-settings-title-bar");
    titleSpan.textContent = "⚙️ Settings";
    header.appendChild(titleSpan);
    
    const closeBtn = mkEl("button", "rs-settings-close-btn");
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Close");
    header.appendChild(closeBtn);
    
    const content = mkEl("div", "rs-settings-content");
    
    // Tab navigation
    const tabNav = mkEl("div", "rs-tabs-nav");
    
    const localTabBtn = mkEl("button", "rs-tab-btn active");
    localTabBtn.textContent = "🏠 Local Model";
    
    const remoteTabBtn = mkEl("button", "rs-tab-btn");
    remoteTabBtn.textContent = "🌐 Remote API";
    
    tabNav.appendChild(localTabBtn);
    tabNav.appendChild(remoteTabBtn);
    
    // Tab content containers
    const localTabContent = mkEl("div", "rs-tab-content rs-tab-content-local");
    
    const localInfoText = mkEl("div", "rs-settings-info");
    localInfoText.innerHTML = `
        <div class="rs-settings-title">Local LLM Model</div>
        <div class="rs-settings-desc">Choose the local model to use for AI features (requires download)</div>
    `;
    
    const modelList = mkEl("div", "rs-settings-model-list");
    
    const localStatusText = mkEl("div", "rs-settings-status");
    localStatusText.textContent = "";
    localStatusText.style.display = "none";
    
    localTabContent.append(localInfoText, modelList, localStatusText);
    
    // Remote API tab content
    const remoteTabContent = mkEl("div", "rs-tab-content");
    remoteTabContent.id = "rs-remote-api-content";
    
    const remoteInfoText = mkEl("div", "rs-settings-info");
    remoteInfoText.innerHTML = `
        <div class="rs-settings-title">Remote LLM API</div>
        <div class="rs-settings-desc">Use cloud-based AI models (OpenAI, Anthropic, Ollama, etc.)</div>
    `;
    
    // Remote config form
    const remoteForm = mkEl("div", "rs-remote-form");
    
    // Enable switch
    const enableRow = mkEl("div", "rs-config-row");
    const enableLabel = mkEl("label", "rs-switch-container");
    const enableCheckbox = mkEl("input", "rs-remote-enabled-checkbox");
    enableCheckbox.type = "checkbox";
    enableCheckbox.id = "rs-remote-enabled";
    const enableText = mkEl("span", "rs-switch-label");
    enableText.textContent = "Enable Remote LLM";
    enableLabel.appendChild(enableCheckbox);
    enableLabel.appendChild(enableText);
    enableRow.appendChild(enableLabel);
    
    // Enable status indicator
    const enableStatusText = mkEl("div", "rs-enable-status");
    enableStatusText.textContent = "";
    enableStatusText.style.display = "none";
    enableStatusText.style.fontSize = "11px";
    enableStatusText.style.color = "#999";
    enableStatusText.style.marginTop = "2px";
    
    // Provider select
    const providerRow = mkEl("div", "rs-config-row");
    const providerLabel = mkEl("label", "rs-form-label");
    providerLabel.textContent = "Provider";
    
    const providerSelect = mkEl("select", "rs-form-input rs-remote-provider");
    providerSelect.id = "rs-remote-provider";
    providerSelect.innerHTML = `
        <option value="openai">OpenAI Compatible</option>
        <option value="lmstudio">LM Studio</option>
        <option value="ollama">Ollama</option>
    `;
    
    providerRow.appendChild(providerLabel);
    providerRow.appendChild(providerSelect);
    
    // Provider change handler - 动态显示/隐藏字段 + 自动获取模型
    // 所有在前向引用中的变量都需要提前用 let 声明
    let modelSelectEl;  // 前向声明（在 provider change handler 中使用）
    let baseUrlInput;   // 前向声明（在 blur handler 和 provider change handler 中使用）
    let apiKeyInput;    // 前向声明（在 provider change handler 中使用）
    let apiKeyRow;      // 前向声明（在 provider change handler 中使用）
    let modelInput;     // 前向声明（在 provider change handler 中使用）
    
    const fetchModelsFromUrl = async (baseUrl, targetSelect) => {
        // 先清除旧选项，显示"获取中..."
        targetSelect.innerHTML = '';
        const loadingOpt = document.createElement('option');
        loadingOpt.value = '__loading__';
        loadingOpt.textContent = '⏳ Loading models...';
        targetSelect.appendChild(loadingOpt);
        targetSelect.disabled = true;  // 禁用选择框防止干扰
        
        try {
            // 通过 ComfyUI 后端代理转发请求，避免 CORS 问题
            const proxyUrl = `/rs_prompts/fetch_remote_models`;
            const resp = await fetch(proxyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base_url: baseUrl })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const result = await resp.json();
            if (!result.success) throw new Error(result.error || 'Failed');
            
            const data = result.data;
            targetSelect.innerHTML = '';
            
            (data.data || []).forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.id;
                targetSelect.appendChild(opt);
            });
            
            if (!targetSelect.options.length) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'No models found';
                targetSelect.appendChild(opt);
            }
        } catch (e) {
            console.warn('Failed to fetch models:', e);
            targetSelect.innerHTML = '<option value="">❌ Failed to load</option>';
        } finally {
            targetSelect.disabled = false;  // 恢复选择框可用
        }
    };
    
    // 辅助函数：在 select 中设置已保存的模型值（如果存在则选中，否则添加并选中）
    const setSelectedModelValue = (modelSelect, modelValue) => {
        if (!modelValue || !modelSelect) return;
        
        let found = false;
        for (let i = 0; i < modelSelect.options.length; i++) {
            if (modelSelect.options[i].value === modelValue) {
                modelSelect.value = modelValue;
                found = true;
                break;
            }
        }
        
        // 如果没找到，添加到列表并选中
        if (!found) {
            const opt = document.createElement('option');
            opt.value = modelValue;
            opt.textContent = modelValue;
            modelSelect.appendChild(opt);
            modelSelect.value = modelValue;
        }
    };
    
    providerSelect.addEventListener("change", async () => {
        const provider = providerSelect.value;
        
        if (provider === 'openai') {
            apiKeyRow.style.display = "flex";
            apiKeyInput.placeholder = "sk-... (optional for cloud)";
            modelInput.style.display = 'block';
            modelSelectEl.style.display = 'none';
            modelInput.type = "text";
            modelInput.placeholder = "e.g., gpt-4o-mini";
            // OpenAI Compatible 默认不设置 Base URL（留空使用默认 API）
            baseUrlInput.value = "";
        } else if (provider === 'lmstudio') {
            apiKeyRow.style.display = "none";
            apiKeyInput.value = "";
            baseUrlInput.value = "http://localhost:1234/v1";
            
            modelInput.style.display = 'none';
            // 使用 setProperty + important 确保覆盖内联样式
            modelSelectEl.style.setProperty('display', 'block', 'important');
            
            // 自动获取模型列表
            fetchModelsFromUrl("http://localhost:1234/v1", modelSelectEl);
        } else if (provider === 'ollama') {
            apiKeyRow.style.display = "none";
            apiKeyInput.value = "";
            baseUrlInput.value = "http://localhost:11430/v1";
            
            modelInput.style.display = 'none';
            // 使用 setProperty + important 确保覆盖内联样式
            modelSelectEl.style.setProperty('display', 'block', 'important');
            
            // 自动获取模型列表
            fetchModelsFromUrl("http://localhost:11430/v1", modelSelectEl);
        }
    });
    
    // Enable change handler - show status + auto-save
    let enableSaveTimeout = null;
    const handleEnableChange = async () => {
        enableStatusText.textContent = enableCheckbox.checked ? "✅ Remote LLM enabled" : "⚪ Remote LLM disabled";
        enableStatusText.style.display = "block";
        enableStatusText.style.color = "#16a34a";
        
        setTimeout(() => {
            enableStatusText.style.display = "none";
        }, 1500);
        
        // Trigger auto-save after status shown
        if (enableSaveTimeout) clearTimeout(enableSaveTimeout);
        enableSaveTimeout = setTimeout(autoSaveConfig, 200);
    };
    
    enableCheckbox.addEventListener("change", handleEnableChange);
    
    // Model input (OpenAI Compatible 为输入框，LM Studio/Ollama 为下拉选择)
    const modelRow = mkEl("div", "rs-config-row");
    const modelLabel = mkEl("label", "rs-form-label");
    modelLabel.textContent = "Model";
    
    modelInput = document.createElement('input');
    modelInput.type = "text";
    modelInput.className = "rs-form-input rs-remote-model";
    modelInput.id = "rs-remote-model";
    modelInput.placeholder = "e.g., gpt-4o-mini";
    
    // 创建 Model select（LM Studio/Ollama 时显示）
    modelSelectEl = document.createElement('select');
    modelSelectEl.className = 'rs-form-input rs-remote-model';
    modelSelectEl.id = 'rs-remote-model-select';
    modelSelectEl.style.display = 'none';
    
    modelRow.appendChild(modelLabel);
    
    // API Key input
    apiKeyRow = mkEl("div", "rs-config-row");
    const apiKeyLabel = mkEl("label", "rs-form-label");
    apiKeyLabel.textContent = "API Key";
    
    apiKeyInput = mkEl("input", "rs-form-input rs-remote-api-key");
    apiKeyInput.type = "password";
    apiKeyInput.id = "rs-remote-api-key";
    apiKeyInput.placeholder = "Optional for local services";
    
    apiKeyRow.appendChild(apiKeyLabel);
    apiKeyRow.appendChild(apiKeyInput);
    
    // Base URL input
    const baseUrlRow = mkEl("div", "rs-config-row");
    const baseUrlLabel = mkEl("label", "rs-form-label");
    baseUrlLabel.textContent = "Base URL";
    
    baseUrlInput = mkEl("input", "rs-form-input rs-remote-base-url");
    baseUrlInput.type = "text";
    baseUrlInput.id = "rs-remote-base-url";
    baseUrlInput.placeholder = "Leave empty for default";
    
    baseUrlRow.appendChild(baseUrlLabel);
    baseUrlRow.appendChild(baseUrlInput);
    
    // Remote form buttons row - 自动保存，不需要保存按钮
    const remoteBtnRow = mkEl("div", "rs-remote-btn-row rs-modal-btns");
    remoteBtnRow.style.display = "none";  // 隐藏按钮行
    
    // Provider save status indicator
    const providerSaveStatusText = mkEl("div", "rs-provider-save-status");
    providerSaveStatusText.textContent = "";
    providerSaveStatusText.style.display = "none";
    providerSaveStatusText.style.fontSize = "11px";
    providerSaveStatusText.style.color = "#999";
    providerSaveStatusText.style.marginTop = "4px";
    
    // 将 modelInput 和 modelSelect 都加入 DOM
    modelRow.appendChild(modelInput);
    
    const modelRowWrapper = mkEl("div", "rs-config-row");
    modelRowWrapper.id = "rs-model-input-wrapper";
    modelRowWrapper.appendChild(modelInput);
    modelRowWrapper.appendChild(modelSelectEl);
    
    remoteForm.append(enableRow, enableStatusText, providerRow, modelRowWrapper, apiKeyRow, baseUrlRow, remoteBtnRow, providerSaveStatusText);
    
    remoteTabContent.append(remoteInfoText, remoteForm);
    
    content.append(tabNav, localTabContent, remoteTabContent);
    
    const statusText = mkEl("div", "rs-settings-status");
    statusText.textContent = "";
    statusText.style.display = "none";
    
    wrapper.append(header, content);
    modal.appendChild(wrapper);
    
    // Tab switching logic
    localTabBtn.addEventListener("click", () => {
        localTabBtn.classList.add("active");
        remoteTabBtn.classList.remove("active");
        localTabContent.style.display = "block";
        remoteTabContent.style.display = "none";
    });
    
    remoteTabBtn.addEventListener("click", () => {
        remoteTabBtn.classList.add("active");
        localTabBtn.classList.remove("active");
        localTabContent.style.display = "none";
        remoteTabContent.style.display = "block";
    });
    
    // Provider save handler - 获取当前显示的 model 值
    const getModelValue = () => {
        const provider = providerSelect.value;
        if (provider === 'openai') {
            // OpenAI Compatible 使用 text input
            return modelInput.value;
        } else {
            // LM Studio / Ollama 使用 select dropdown
            if (modelSelectEl && modelSelectEl.style.display !== 'none') {
                return modelSelectEl.value;
            }
            // Fallback to modelInput
            return modelInput.value;
        }
    };
    
    // 自动保存函数 - 失去焦点时调用
    let saveTimeout = null;
    const autoSaveConfig = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            const modelValue = getModelValue();
            const config = {
                enabled: enableCheckbox.checked,
                provider: providerSelect.value,
                model: modelValue,
                api_key: apiKeyInput.value,
                base_url: baseUrlInput.value
            };

            const result = await window.NeoNodes?.saveRemoteLLMConfig?.(config);
            
            if (result && result.success) {
                providerSaveStatusText.textContent = "✅ Saved";
                providerSaveStatusText.style.display = "block";
                providerSaveStatusText.style.color = "#16a34a";
                
                setTimeout(() => {
                    providerSaveStatusText.style.display = "none";
                }, 1500);
            } else {
                providerSaveStatusText.textContent = "❌ Save failed";
                providerSaveStatusText.style.display = "block";
                providerSaveStatusText.style.color = "#dc2626";
                
                setTimeout(() => {
                    providerSaveStatusText.style.display = "none";
                }, 2000);
            }
        }, 300);  // 防抖 300ms
    };
    
    // 所有字段失去焦点时自动保存（enableCheckbox 已在 handleEnableChange 中调用 autoSaveConfig）
    providerSelect.addEventListener("change", autoSaveConfig);
    apiKeyInput.addEventListener("blur", autoSaveConfig);
    baseUrlInput.addEventListener("blur", autoSaveConfig);
    modelInput.addEventListener("blur", autoSaveConfig);
    modelSelectEl.addEventListener("change", () => {
        autoSaveConfig();
    });
    
    
    return { 
        modal, 
        overlay,  // 遮罩层引用
        modelList, 
        statusText, 
        closeBtn,
        enableCheckbox,
        providerSelect,
        modelInput,
        modelSelectEl,
        apiKeyInput,
        apiKeyRow,
        baseUrlInput,
        enableStatusText,
        providerSaveStatusText,
        localTabBtn,
        remoteTabBtn,
        localTabContent,
        remoteTabContent,
        autoSaveConfig,  // 导出供外部使用（关闭前保存）
        fetchModelsFromUrl,  // 暴露给外部用于 loadRemoteLLMConfig 自动获取模型
        setSelectedModelValue  // 暴露给外部用于加载后选中已保存的模型
    };
}

async function loadRemoteLLMConfig(settingsModal) {
    const config = await window.NeoNodes?.getRemoteLLMConfig?.();
    if (config) {
        settingsModal.enableCheckbox.checked = config.enabled || false;
        settingsModal.providerSelect.value = config.provider || 'openai';
        settingsModal.apiKeyInput.value = config.api_key === '***' ? '' : (config.api_key || '');
        if (config.base_url) {
            settingsModal.baseUrlInput.value = config.base_url;
        }
        
        // 直接调用 provider change handler（不触发事件，避免误触 autoSaveConfig）
        const provider = settingsModal.providerSelect.value;
        let targetBaseUrl = null;  // 记录要获取模型的 Base URL
        
        if (provider === 'openai') {
            settingsModal.apiKeyRow.style.display = "flex";
            settingsModal.modelInput.style.display = '';
            settingsModal.modelSelectEl.style.display = 'none';
            settingsModal.modelInput.type = "text";
            settingsModal.modelInput.placeholder = "e.g., gpt-4o-mini";
            
            // 设置 OpenAI Compatible 的 model value
            if (config.model) {
                setTimeout(() => {
                    const modelInput = document.getElementById("rs-remote-model");
                    if (modelInput) modelInput.value = config.model;
                }, 50);
            }
        } else if (provider === 'lmstudio') {
            settingsModal.apiKeyRow.style.display = "none";
            settingsModal.apiKeyInput.value = "";
            targetBaseUrl = "http://localhost:1234/v1";
            settingsModal.baseUrlInput.value = targetBaseUrl;
            settingsModal.modelInput.style.display = 'none';
            // 使用 setProperty + important 确保覆盖内联样式
            settingsModal.modelSelectEl.style.setProperty('display', 'block', 'important');
        } else if (provider === 'ollama') {
            settingsModal.apiKeyRow.style.display = "none";
            settingsModal.apiKeyInput.value = "";
            targetBaseUrl = "http://localhost:11430/v1";
            settingsModal.baseUrlInput.value = targetBaseUrl;
            settingsModal.modelInput.style.display = 'none';
            // 使用 setProperty + important 确保覆盖内联样式
            settingsModal.modelSelectEl.style.setProperty('display', 'block', 'important');
        }
        
        // LM Studio / Ollama 需要自动获取模型列表，然后选中已保存的模型
        if ((provider === 'lmstudio' || provider === 'ollama')) {
            console.log('[prompt-manager] Auto-fetching models for', provider, 'with baseUrl:', targetBaseUrl);
            const baseUrl = targetBaseUrl;
            if (baseUrl) {
                settingsModal.fetchModelsFromUrl(baseUrl, settingsModal.modelSelectEl).then(() => {
                    console.log('[prompt-manager] Models fetched, selecting saved model:', config.model);
                    // 模型列表加载完成后，自动选中已保存的模型值
                    setTimeout(() => {
                        settingsModal.setSelectedModelValue(settingsModal.modelSelectEl, config.model);
                    }, 100);
                }).catch(err => {
                    console.error('[prompt-manager] Failed to fetch models:', err);
                });
            }
        }
        
        if (config.enabled) {
            settingsModal.localTabBtn.classList.remove("active");
            settingsModal.remoteTabBtn.classList.add("active");
            settingsModal.localTabContent.style.display = "none";
            settingsModal.remoteTabContent.style.display = "block";
        }
    }
}

// 快速输入功能使用提示 - 随机显示
const QUICK_INPUT_TIPS = [
    "✨ 输入描述，AI 自动帮你生成提示词",
    "📝 输入改写需求，如：'去掉动漫风格，改成写实'",
    "🌐 输入翻译需求，如：'翻译成中文'",
    "🎨 输入风格要求，如：'改成赛博朋克风格'",
    "📷 输入场景描述，如：'夕阳下的海边日落'",
    "🔍 输入搜索关键词，查找已有提示词",
    "🎲 点击骰子按钮，随机生成提示词",
    "📋 点击列表按钮，浏览所有预设提示词",
    "💾 点击保存按钮，将提示词保存为预设",
    "⚙️ 点击设置按钮，切换 AI 模型",
    "🚀 输入描述后点击生成，快速创建提示词",
    "🔄 输入修改指令，如：'增加细节描述'",
    "🎭 输入角色描述，如：'一个穿着汉服的女孩'",
    "🌅 输入时间场景，如：'清晨的森林，阳光穿透树叶'",
    "🏙️ 输入城市描述，如：'未来科幻城市，高楼林立'"
];

function getRandomTip() {
    return QUICK_INPUT_TIPS[Math.floor(Math.random() * QUICK_INPUT_TIPS.length)];
}

function createStatusBars() {
    const statusBar = mkEl("div", "rs-status-bar");
    
    const toggleWrapper = mkEl("div", "rs-toggle-wrapper");
    
    const toggleSwitch = mkEl("div", "rs-toggle-switch");
    toggleSwitch.setAttribute("data-rs-tooltip", "Enable external text input");
    toggleSwitch.style.setProperty('background', '#3a3a3a', 'important');
    toggleSwitch.style.setProperty('border-color', '#555', 'important');

    const toggleKnob = mkEl("div", "rs-toggle-knob");
    toggleKnob.style.setProperty('transform', 'translateX(0)', 'important');
    toggleKnob.style.setProperty('background', '#999', 'important');

    toggleSwitch.appendChild(toggleKnob);
    toggleWrapper.appendChild(toggleSwitch);
    
    const statusText = mkEl("span");
    statusText.textContent = "🟢 LOCAL PROMPT";
    
    const settingsBtn = mkEl("button", "rs-settings-btn");
    settingsBtn.textContent = "⚙️";
    settingsBtn.setAttribute("data-rs-tooltip", "Model settings");
    
    statusBar.appendChild(toggleWrapper);
    statusBar.appendChild(statusText);

    const quickInputWrapper = mkEl("div", "rs-quick-input-wrapper");

    const randomBtn = mkEl("button", "rs-random-btn");
    randomBtn.textContent = "🎲";
    randomBtn.setAttribute("data-rs-tooltip", "Random prompt");

    const listBtn = mkEl("button", "rs-list-btn");
    listBtn.textContent = "☰";
    listBtn.setAttribute("data-rs-tooltip", "Preset list");

    const quickInput = mkEl("input", "rs-quick-input");
    quickInput.placeholder = '🔍 Search presets or describe...';
    
    // 定时器用于随机切换提示词
    let tipInterval = null;
    
    function startTipRotation() {
        stopTipRotation();
        tipInterval = setInterval(() => {
            if (!quickInput.value.trim()) {
                quickInput.placeholder = getRandomTip();
            }
        }, 5000); // 每 5 秒随机切换一次
    }
    
    function stopTipRotation() {
        if (tipInterval) {
            clearInterval(tipInterval);
            tipInterval = null;
        }
    }
    
    // 随机显示提示词 - 聚焦时切换
    quickInput.addEventListener("focus", () => {
        quickInput.placeholder = getRandomTip();
        startTipRotation();
    });
    
    // 失焦时恢复默认 placeholder
    quickInput.addEventListener("blur", () => {
        stopTipRotation();
        if (!quickInput.value.trim()) {
            quickInput.placeholder = '🔍 Search presets or describe...';
        }
    });

    const generateBtn = mkEl("button", "rs-generate-btn");
    generateBtn.textContent = "✨";
    generateBtn.setAttribute("data-rs-tooltip", "Generate from description");

    quickInputWrapper.appendChild(randomBtn);
    quickInputWrapper.appendChild(listBtn);
    quickInputWrapper.appendChild(quickInput);
    quickInputWrapper.appendChild(generateBtn);
    quickInputWrapper.appendChild(settingsBtn);

    const customTextarea = document.createElement("textarea");
    customTextarea.className = "comfy-multiline-input";
    customTextarea.placeholder = "Enter your prompt here...";

    const buttonsWrapper = mkEl("div", "rs-buttons-wrapper");
    const btnRow = mkEl("div", "rs-btn-row");

    const enhanceBtn = mkEl("button", "rs-btn");
    enhanceBtn.textContent = "🔧 Enhance";
    enhanceBtn.setAttribute("data-rs-tooltip", "Enhance prompt with AI");
    const translateBtn = mkEl("button", "rs-btn");
    translateBtn.textContent = "🌐 Translate";
    translateBtn.setAttribute("data-rs-tooltip", "Translate prompt");
    const saveBtn = mkEl("button", "rs-btn");
    saveBtn.textContent = "💾 Save";
    saveBtn.setAttribute("data-rs-tooltip", "Save as preset");

    btnRow.append(enhanceBtn, translateBtn, saveBtn);
    buttonsWrapper.append(btnRow);

    return { statusBar, quickInputWrapper, randomBtn, listBtn, quickInput, generateBtn, customTextarea, buttonsWrapper, enhanceBtn, translateBtn, saveBtn, settingsBtn, toggleSwitch, toggleKnob };
}

function createPromptManagerUI() {
    const { statusBar, quickInputWrapper, randomBtn, listBtn, quickInput, generateBtn, customTextarea, buttonsWrapper, enhanceBtn, translateBtn, saveBtn, settingsBtn, toggleSwitch, toggleKnob } = createStatusBars();
    const { overlay: presetListOverlay, body: presetListBody } = createOverlayWithSearch();
    const { modal: presetNameInput, aiStatus, field: inputField, tagsContainer, selectedTags, okBtn: inputOk, cancelBtn: inputCancel } = createInputModal();
    const { modal: deleteConfirmOverlay, textDiv: deleteText, okBtn: deleteOk, cancelBtn: deleteCancel } = createDeleteModal();
    const downloadModal = createDownloadModal();
    const settingsModal = createSettingsModal();

    const root = mkEl("div", "rs-root");
    root.appendChild(statusBar);
    root.appendChild(quickInputWrapper);
    root.appendChild(customTextarea);
    root.appendChild(buttonsWrapper);

    root.appendChild(presetNameInput);
    root.appendChild(deleteConfirmOverlay);
    root.appendChild(downloadModal.modal);
    root.appendChild(settingsModal.overlay);  // Settings overlay (遮罩层)
    root.appendChild(settingsModal.modal);

    presetListBody.style.scrollbarWidth = "thin";
    presetListBody.style.scrollbarColor = "#5090cc #1a1a1a";

    let pendingDeleteName = null;
    let context = null;
    let isLoading = false;
    let isListOpen = false;
    let isSettingsBtnClicked = false;


        // Helper: dispatch synthetic "input" event on customTextarea (triggers auto-switch from EXTERNAL to LOCAL)
        function triggerTextChange() {
            if (customTextarea) {
                customTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
        }

    function init(ctx) {
        context = ctx;
        const { node, graph, textWidget } = ctx;

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
                        const classifyList = classifyText.split(/[,，]/).map(s => s.trim()).filter(s => s);

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

        function performSave() {
            const name = inputField.value.trim();
            if (!name) return;
            presetNameInput.style.display = "none";
            const tags = Array.from(selectedTags);
            savePrompt(name, textWidget ? textWidget.value : "", tags);
        }

        async function loadPresetDropdown() {
            if (isLoading) return;
            isLoading = true;
            
            presetListBody.innerHTML = "";

            const loadingDiv = mkEl("div", "rs-loading");
            loadingDiv.textContent = "Loading...";
            presetListBody.appendChild(loadingDiv);

            try {
                const list = await listPrompts();

                if (loadingDiv.parentNode) loadingDiv.remove();

                if (!list.length) {
                    presetListBody.textContent = "No presets found";
                    isLoading = false;
                    return;
                }

                list.forEach(item => {
                    const name = typeof item === 'string' ? item : item.name;
                    const tags = typeof item === 'string' ? [] : (item.tags || []);
                    const source = typeof item === 'object' ? item.source : "custom";

                    const row = document.createElement("div");
                    row.className = "rs-preset-item";
                    row.dataset.name = name;

                    const leftDiv = mkEl("div", "rs-preset-left");
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

                    const sourceBadge = mkEl("span", "rs-source-badge");
                    sourceBadge.textContent = source === "presets" ? "SYS" : "USR";
                    sourceBadge.title = source === "presets" ? "System preset (cannot delete)" : "User preset";
                    contentSpan.appendChild(sourceBadge);

                    contentSpan.dataset.original = displayText;
                    row.dataset.original = displayText;
                    leftDiv.appendChild(contentSpan);
                    row.appendChild(leftDiv);

                    row.onclick = async (e) => {
                        if (e.target.closest(".rs-delete-icon")) return;

                        const data = await loadPrompt(name);

                        if (textWidget) {
                            textWidget.value = data.text || "";
                        }
                        if (customTextarea) {
                            customTextarea.value = data.text || "";
                            triggerTextChange();
                        }

                        const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                        const currentTextKey = `rs_prompt_${currentUid}`;
                        localStorage.setItem(currentTextKey, data.text || "");

                        presetListOverlay.style.display = "none";
                        if (graph) graph.setDirtyCanvas(true, true);
                    };

                    if (source === "custom") {
                        const deleteBtn = mkEl("span", "rs-delete-icon");
                        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
                        deleteBtn.setAttribute("aria-label", "Delete preset");
                        deleteBtn.onclick = async (e) => {
                            e.stopPropagation();
                            pendingDeleteName = name;
                            deleteText.textContent = `Delete "${name}"?`;
                            deleteConfirmOverlay.style.display = "block";
                        };
                        row.appendChild(deleteBtn);
                    }

                    presetListBody.appendChild(row);
                });
            } catch (e) {
                presetListBody.textContent = "Error loading";
            } finally {
                isLoading = false;
            }
        }

        function filterDropdownByInput(query) {
            presetListBody.innerHTML = "";

            const loadingDiv = mkEl("div", "rs-loading");
            loadingDiv.textContent = "Searching...";
            presetListBody.appendChild(loadingDiv);

            setTimeout(async () => {
                if (loadingDiv.parentNode) loadingDiv.remove();

                const list = await listPrompts();
                const queryLower = query.toLowerCase();
                const matched = list.filter(item => {
                    const name = typeof item === 'string' ? item : item.name;
                    const tags = typeof item === 'string' ? [] : (item.tags || []);
                    return name.toLowerCase().includes(queryLower) || 
                           tags.some(t => t.toLowerCase().includes(queryLower));
                });

                if (!matched.length) {
                    presetListBody.innerHTML = "";
                    return;
                }

                matched.forEach(item => {
                    const name = typeof item === 'string' ? item : item.name;
                    const tags = typeof item === 'string' ? [] : (item.tags || []);
                    const source = typeof item === 'object' ? item.source : "custom";

                    const row = document.createElement("div");
                    row.className = "rs-preset-item";
                    row.dataset.name = name;

                    const leftDiv = mkEl("div", "rs-preset-left");
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

                    const regex = new RegExp(`(${query})`, "gi");
                    const highlightedName = name.replace(regex, '<span class="rs-match-highlight">$1</span>');
                    contentSpan.innerHTML = highlightedName;

                    if (tags && tags.length > 0) {
                        const tagsSpan = document.createElement("span");
                        tagsSpan.className = "rs-tags-part";
                        tagsSpan.textContent = ` [${tags.join(", ")}]`;
                        contentSpan.appendChild(document.createTextNode(" "));
                        contentSpan.appendChild(tagsSpan);
                    }

                    contentSpan.dataset.original = displayText;
                    row.dataset.original = displayText;
                    leftDiv.appendChild(contentSpan);
                    row.appendChild(leftDiv);

                    row.onclick = async (e) => {
                        if (e.target.closest(".rs-delete-icon")) return;

                        const data = await loadPrompt(name);

                        if (textWidget) {
                            textWidget.value = data.text || "";
                        }
                        if (customTextarea) {
                            customTextarea.value = data.text || "";
                            triggerTextChange();
                        }

                        const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                        const currentTextKey = `rs_prompt_${currentUid}`;
                        localStorage.setItem(currentTextKey, data.text || "");

                        presetListOverlay.style.display = "none";
                        if (graph) graph.setDirtyCanvas(true, true);
                    };

                    if (source === "custom") {
                        const deleteBtn = mkEl("span", "rs-delete-icon");
                        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
                        deleteBtn.setAttribute("aria-label", "Delete preset");
                        deleteBtn.onclick = async (e) => {
                            e.stopPropagation();
                            pendingDeleteName = name;
                            deleteText.textContent = `Delete "${name}"?`;
                            deleteConfirmOverlay.style.display = "block";
                        };
                        row.appendChild(deleteBtn);
                    }

                    presetListBody.appendChild(row);
                });
            }, 100);
        }

        async function loadPromptList() {
            presetNameInput.style.display = "none";
            deleteConfirmOverlay.style.display = "none";
            presetListBody.innerHTML = "";
            presetListOverlay.style.display = "flex";

            const loadingDiv = mkEl("div", "rs-loading");
            loadingDiv.textContent = "Loading...";
            presetListBody.appendChild(loadingDiv);

            try {
                const list = await listPrompts();

                if (loadingDiv.parentNode) loadingDiv.remove();

                if (!list.length) {
                    presetListBody.textContent = "No presets found";
                    return;
                }

                list.forEach(item => {
                    const name = typeof item === 'string' ? item : item.name;
                    const tags = typeof item === 'string' ? [] : (item.tags || []);
                    const source = typeof item === 'object' ? item.source : "custom";

                    const row = document.createElement("div");
                    row.className = "rs-preset-item";
                    row.dataset.name = name;

                    const leftDiv = mkEl("div", "rs-preset-left");
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

                    const sourceBadge = mkEl("span", "rs-source-badge");
                    sourceBadge.textContent = source === "presets" ? "SYS" : "USR";
                    sourceBadge.title = source === "presets" ? "System preset (cannot delete)" : "User preset";
                    contentSpan.appendChild(sourceBadge);

                    contentSpan.dataset.original = displayText;
                    row.dataset.original = displayText;
                    leftDiv.appendChild(contentSpan);
                    row.appendChild(leftDiv);

                    row.onclick = async (e) => {
                        if (e.target.closest(".rs-delete-icon")) return;

                        const data = await loadPrompt(name);

                        if (textWidget) {
                            textWidget.value = data.text || "";
                        }
                        if (customTextarea) {
                            customTextarea.value = data.text || "";
                            triggerTextChange();
                        }

                        const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                        const currentTextKey = `rs_prompt_${currentUid}`;
                        localStorage.setItem(currentTextKey, data.text || "");

                        presetListOverlay.style.display = "none";
                        if (graph) graph.setDirtyCanvas(true, true);
                    };

                    if (source === "custom") {
                        const deleteBtn = mkEl("span", "rs-delete-icon");
                        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
                        deleteBtn.setAttribute("aria-label", "Delete preset");
                        deleteBtn.onclick = async (e) => {
                            e.stopPropagation();
                            pendingDeleteName = name;
                            deleteText.textContent = `Delete "${name}"?`;
                            deleteConfirmOverlay.style.display = "block";
                        };
                        row.appendChild(deleteBtn);
                    }

                    presetListBody.appendChild(row);
                });
            } catch (e) {
                presetListBody.textContent = "Error loading";
            }
        }

        saveBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            handleSaveClick();
        }, true);

        // 确保 presetListOverlay 在 quickInputWrapper 内部
        quickInputWrapper.appendChild(presetListOverlay);

        // presetListOverlay 在 quickInput 下方的下拉样式
        presetListOverlay.style.top = "100%";
        presetListOverlay.style.left = "0";
        presetListOverlay.style.right = "";
        presetListOverlay.style.bottom = "";
        presetListOverlay.style.transform = "none";
        presetListOverlay.style.maxWidth = "100%";
        presetListOverlay.style.maxHeight = "250px";
        presetListOverlay.style.marginTop = "2px";

        // 输入框聚焦时关闭列表
        quickInput.addEventListener("focus", () => {
            if (isListOpen) {
                presetListOverlay.style.display = "none";
                isListOpen = false;
            }
        });

        // 输入框输入 → 实时筛选
        quickInput.addEventListener("input", () => {
            const query = quickInput.value.trim();
            if (query) {
                filterDropdownByInput(query);
                presetListOverlay.style.display = "flex";
            } else {
                presetListOverlay.style.display = "none";
            }
        });

        // 输入框失焦时关闭 overlay（但点击列表项时不关闭）
        quickInput.addEventListener("blur", () => {
            if (!isListOpen) return;
            setTimeout(() => {
                if (!quickInputWrapper.contains(document.activeElement)) {
                    presetListOverlay.style.display = "none";
                    isListOpen = false;
                }
            }, 100);
        });

        // 列表按钮点击 → 更新 isListOpen 状态
        listBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (presetListOverlay.style.display === "flex") {
                presetListOverlay.style.display = "none";
                isListOpen = false;
            } else {
                loadPresetDropdown();
                presetListOverlay.style.display = "flex";
                isListOpen = true;
            }
        });

        // 点击外部时关闭 overlay（但点击 overlay 内部时不关闭）
        document.addEventListener("mousedown", (e) => {
            if (!quickInputWrapper.contains(e.target) && !presetListOverlay.contains(e.target)) {
                presetListOverlay.style.display = "none";
                isListOpen = false;
            }
        });

        inputOk.addEventListener("click", performSave);
        inputCancel.addEventListener("click", () => {
            presetNameInput.style.display = "none";
        });
        inputField.addEventListener("keydown", (e) => {
            if (e.key === "Enter") performSave();
            if (e.key === "Escape") presetNameInput.style.display = "none";
        });

        deleteOk.addEventListener("click", async () => {
            if (pendingDeleteName) {
                await deletePrompt(pendingDeleteName);
                deleteConfirmOverlay.style.display = "none";
                if (!quickInput.value.trim()) {
                    loadPresetDropdown();
                }
                pendingDeleteName = null;
            }
        });

        deleteCancel.addEventListener("click", () => {
            deleteConfirmOverlay.style.display = "none";
            pendingDeleteName = null;
        });

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
            
            downloadModal.progressContainer.style.display = "block";
            downloadModal.downloadBtn.style.display = "none";
            downloadModal.cancelBtn.style.display = "none";
            downloadModal.closeBtn.style.display = "none";
            downloadModal.statusText.textContent = "Download started...";
            downloadModal.statusText.style.color = "#999";
            
            monitorDownloadProgress(downloadModal, statusBar);
        });

        downloadModal.cancelBtn.addEventListener("click", () => {
            downloadModal.modal.style.display = "none";
        });

        downloadModal.closeBtn.addEventListener("click", () => {
            downloadModal.modal.style.display = "none";
        });

        let downloadPollInterval = null;
        
        function stopDownloadPolling() {
            if (downloadPollInterval) {
                clearInterval(downloadPollInterval);
                downloadPollInterval = null;
            }
        }
        
        function startDownloadPolling() {
            stopDownloadPolling();
            downloadPollInterval = setInterval(async () => {
                try {
                    const status = await checkModel();
                    if (status.download_status?.model?.downloading) {
                        const progress = status.download_status.model.progress || 0;
                        const progressFill = settingsModal.modelList.querySelector(".rs-download-progress-fill");
                        if (progressFill) {
                            progressFill.style.width = progress + "%";
                        }
                        const statusIndicator = settingsModal.modelList.querySelector(".rs-settings-download-status");
                        if (statusIndicator) {
                            statusIndicator.textContent = `⏳ Downloading ${progress}%`;
                            statusIndicator.style.color = "#fbbf24";
                        }
                    } else {
                        stopDownloadPolling();
                        loadModelsIntoSettings();
                    }
                } catch (e) {
                    console.error("Failed to check download status:", e);
                }
            }, 500);
        }
        
        async function loadModelsIntoSettings() {
            try {
                stopDownloadPolling();
                const modelsData = await getAvailableModels();
                const allModelsStatus = await checkAllModels();
                const currentModelStatus = await checkModel();
                settingsModal.modelList.innerHTML = "";
                
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
                    
                    const isModelAvailable = modelStatusMap[model.key] || false;
                    const isDownloading = modelStatusMap[model.key] === undefined && isCurrentModel && currentModelStatus.download_status?.model?.downloading;
                    const downloadProgress = currentModelStatus.download_status?.model?.progress || 0;
                    
                    const modelName = mkEl("div", "rs-settings-model-name");
                    
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
                    
                    const nameText = mkEl("span");
                    nameText.textContent = model.name;
                    modelName.appendChild(nameText);
                    
                    const modelSize = mkEl("span", "rs-model-size");
                    modelSize.textContent = model.size || "";
                    modelName.appendChild(modelSize);
                    
                    modelInfo.appendChild(modelName);
                    
                    if (!isModelAvailable) {
                        const modelFilename = mkEl("div", "rs-settings-model-filename");
                        modelFilename.textContent = model.filename;
                        modelInfo.appendChild(modelFilename);
                    }
                    
                    const rightSection = mkEl("div", "rs-settings-model-right");
                    
                    if (!isModelAvailable) {
                        const downloadBtn = mkEl("button", "rs-download-btn-small");
                        downloadBtn.textContent = "⬇";
                        downloadBtn.title = "Download this model";
                        downloadBtn.addEventListener("click", async (e) => {
                            e.stopPropagation();
                            downloadBtn.disabled = true;
                            downloadBtn.textContent = "⏳";
                            
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
                            
                            const downloadResult = await downloadModel("model");
                            if (downloadResult.error) {
                                downloadBtn.disabled = false;
                                downloadBtn.textContent = "⬇";
                                settingsModal.statusText.style.display = "block";
                                settingsModal.statusText.textContent = "Download failed: " + downloadResult.error;
                                settingsModal.statusText.className = "rs-settings-status";
                            } else {
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

        settingsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            isSettingsBtnClicked = true;
            
            // Toggle settings modal
            if (settingsModal.modal.style.display === "flex") {
                settingsModal.modal.style.display = "none";
                settingsModal.overlay.style.display = "none";
                return;
            }
            
            // 使用 offsetParent 累加计算按钮在页面中的精确位置
            let accumulatedTop = 0;
            let accumulatedLeft = 0;
            let currentEl = settingsBtn;
            
            while (currentEl && currentEl !== root) {
                accumulatedTop += currentEl.offsetTop || 0;
                accumulatedLeft += currentEl.offsetLeft || 0;
                currentEl = currentEl.offsetParent;
            }
            
            // 垂直居中：按钮位置 + 按钮高度一半 - modal 高度一半
            const btnHeight = settingsBtn.offsetHeight || 24;
            const modalHeight = settingsModal.modal.offsetHeight || 400;
            const topPos = accumulatedTop + (btnHeight / 2) - (modalHeight / 2);
            
            // 水平位置：按钮右侧 + 5px 偏移
            const leftPos = accumulatedLeft + settingsBtn.offsetWidth + 5;
            
            settingsModal.modal.style.position = "absolute";
            settingsModal.modal.style.zIndex = "999999";
            settingsModal.modal.style.top = topPos + "px";
            settingsModal.modal.style.left = leftPos + "px";
            settingsModal.modal.style.transform = "none";
            settingsModal.modal.style.margin = "0";
            settingsModal.modal.style.justifyContent = "flex-start";
            settingsModal.modal.style.alignItems = "flex-start";
            settingsModal.modal.style.opacity = "1";
            settingsModal.modal.style.visibility = "visible";
            
            // 显示遮罩层 + modal（真正的模态窗口）
            settingsModal.overlay.style.display = "block";
            settingsModal.modal.style.display = "flex";
            
            loadModelsIntoSettings();
            loadRemoteLLMConfig(settingsModal);
        });
        
        // 点击遮罩层不关闭（真正的模态行为）- 阻止事件冒泡防止 ComfyUI 全局处理
        settingsModal.overlay.addEventListener("click", (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            // 什么都不做，只阻止默认行为和冒泡
        });
        
        // 确保 modal 内部点击也不冒泡到 document
        settingsModal.modal.addEventListener("click", (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
        }, true);
        
        // 关闭前自动保存 Remote API 配置
        const closeSettingsModal = async () => {
            // 先触发自动保存（通过 settingsModal.autoSaveConfig）
            if (settingsModal.autoSaveConfig) {
                settingsModal.autoSaveConfig();
            }
            // 等待一下让保存请求发出
            await new Promise(resolve => setTimeout(resolve, 350));
            settingsModal.modal.style.display = "none";
            settingsModal.overlay.style.display = "none";
        };
        
        // 使用 capture 阶段捕获 mousedown + click，防止 ComfyUI 全局事件拦截
        const handleCloseClick = (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            closeSettingsModal();
        };
        
        settingsModal.closeBtn.addEventListener("mousedown", handleCloseClick, true);
        settingsModal.closeBtn.addEventListener("click", handleCloseClick, true);

        // ESC 键关闭 settings modal + overlay（关闭前自动保存）
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && settingsModal.modal.style.display === "flex") {
                closeSettingsModal();
            }
        });

        return {
            statusBar,
            quickInputWrapper,
            enhanceBtn,
            translateBtn,
            generateBtn,
            randomBtn,
            listBtn,
            quickInput,
            customTextarea,
            settingsBtn,
            toggleSwitch,
            toggleKnob,
            saveBtn,
            presetListOverlay,
            presetNameInput,
            deleteConfirmOverlay,
            downloadModal,
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
    createSettingsModal,
    loadRemoteLLMConfig
};