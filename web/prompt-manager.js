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
        <option value="openai">OpenAI (GPT-4o, etc.)</option>
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="ollama">Ollama (Local)</option>
        <option value="lmstudio">LM Studio</option>
        <option value="llamacpp">llama.cpp Server</option>
        <option value="vllm">vLLM</option>
        <option value="zhipu">智谱 (Zhipu GLM)</option>
        <option value="doubao">豆包 (Doubao)</option>
    `;
    
    providerRow.appendChild(providerLabel);
    providerRow.appendChild(providerSelect);
    
    // Enable change handler - auto-save
    enableCheckbox.addEventListener("change", async () => {
        const config = {
            enabled: enableCheckbox.checked,
            provider: providerSelect.value,
            model: modelInput.value,
            api_key: apiKeyInput.value,
            base_url: baseUrlInput.value,
            max_tokens: parseInt(maxTokensInput.value) || 500,
            timeout: parseInt(timeoutInput.value) || 60,
            temperature: parseFloat(temperatureInput?.value) || 0.0
        };
        
        const result = await window.NeoNodes?.saveRemoteLLMConfig?.(config);
        
        if (result && result.success) {
            enableStatusText.textContent = enableCheckbox.checked ? "✅ Remote LLM enabled" : "⚪ Remote LLM disabled";
            enableStatusText.style.display = "block";
            enableStatusText.style.color = "#16a34a";
            
            setTimeout(() => {
                enableStatusText.style.display = "none";
            }, 1500);
        } else {
            enableStatusText.textContent = "❌ Save failed";
            enableStatusText.style.display = "block";
            enableStatusText.style.color = "#dc2626";
            
            setTimeout(() => {
                enableStatusText.style.display = "none";
            }, 2000);
            
            // Revert checkbox
            enableCheckbox.checked = !enableCheckbox.checked;
        }
    });
    
    // Model input
    const modelRow = mkEl("div", "rs-config-row");
    const modelLabel = mkEl("label", "rs-form-label");
    modelLabel.textContent = "Model";
    
    const modelInput = mkEl("input", "rs-form-input rs-remote-model");
    modelInput.type = "text";
    modelInput.id = "rs-remote-model";
    modelInput.placeholder = "e.g., gpt-4o-mini";
    
    modelRow.appendChild(modelLabel);
    modelRow.appendChild(modelInput);
    
    // API Key input
    const apiKeyRow = mkEl("div", "rs-config-row");
    const apiKeyLabel = mkEl("label", "rs-form-label");
    apiKeyLabel.textContent = "API Key";
    
    const apiKeyInput = mkEl("input", "rs-form-input rs-remote-api-key");
    apiKeyInput.type = "password";
    apiKeyInput.id = "rs-remote-api-key";
    apiKeyInput.placeholder = "Optional for local services";
    
    apiKeyRow.appendChild(apiKeyLabel);
    apiKeyRow.appendChild(apiKeyInput);
    
    // Base URL input
    const baseUrlRow = mkEl("div", "rs-config-row");
    const baseUrlLabel = mkEl("label", "rs-form-label");
    baseUrlLabel.textContent = "Base URL";
    
    const baseUrlInput = mkEl("input", "rs-form-input rs-remote-base-url");
    baseUrlInput.type = "text";
    baseUrlInput.id = "rs-remote-base-url";
    baseUrlInput.placeholder = "Leave empty for default";
    
    baseUrlRow.appendChild(baseUrlLabel);
    baseUrlRow.appendChild(baseUrlInput);
    
    // Max tokens and temperature row
    const paramsRow = mkEl("div", "rs-params-row");
    
    const maxTokensCol = mkEl("div", "rs-config-col");
    const maxTokensLabel = mkEl("label", "rs-form-label");
    maxTokensLabel.textContent = "Max Tokens";
    
    const maxTokensInput = mkEl("input", "rs-form-input rs-remote-max-tokens");
    maxTokensInput.type = "number";
    maxTokensInput.value = "500";
    maxTokensInput.min = "1";
    maxTokensInput.max = "8192";
    
    maxTokensCol.appendChild(maxTokensLabel);
    maxTokensCol.appendChild(maxTokensInput);
    
    const timeoutCol = mkEl("div", "rs-config-col");
    const timeoutLabel = mkEl("label", "rs-form-label");
    timeoutLabel.textContent = "Timeout (s)";
    
    const timeoutInput = mkEl("input", "rs-form-input rs-remote-timeout");
    timeoutInput.type = "number";
    timeoutInput.value = "60";
    timeoutInput.min = "10";
    timeoutInput.max = "300";
    
    timeoutCol.appendChild(timeoutLabel);
    timeoutCol.appendChild(timeoutInput);
    
    const temperatureCol = mkEl("div", "rs-config-col");
    const temperatureLabel = mkEl("label", "rs-form-label");
    temperatureLabel.textContent = "Temperature";
    
    const temperatureInput = mkEl("input", "rs-form-input rs-remote-temperature");
    temperatureInput.type = "number";
    temperatureInput.value = "0.0";
    temperatureInput.step = "0.1";
    temperatureInput.min = "0";
    temperatureInput.max = "2";
    
    temperatureCol.appendChild(temperatureLabel);
    temperatureCol.appendChild(temperatureInput);
    
    paramsRow.appendChild(maxTokensCol);
    paramsRow.appendChild(timeoutCol);
    paramsRow.appendChild(temperatureCol);
    
    // Remote form buttons row
    const remoteBtnRow = mkEl("div", "rs-remote-btn-row rs-modal-btns");
    
    const remoteSaveBtn = mkEl("button", "rs-btn rs-remote-save-btn");
    remoteSaveBtn.textContent = "💾 Save Provider Settings";
    remoteSaveBtn.type = "button";
    remoteSaveBtn.style.cssText = "display:block !important; visibility:visible !important; width:100% !important; padding:6px 12px !important; background:#1a3a5a !important; color:#60a5fa !important; border:1px solid #3a6a9a !important; border-radius:4px !important; cursor:pointer !important; font-size:12px !important; font-weight:500 !important; pointer-events:auto !important;";
    
    // Provider save status indicator
    const providerSaveStatusText = mkEl("div", "rs-provider-save-status");
    providerSaveStatusText.textContent = "";
    providerSaveStatusText.style.display = "none";
    providerSaveStatusText.style.fontSize = "11px";
    providerSaveStatusText.style.color = "#999";
    providerSaveStatusText.style.marginTop = "4px";
    
    // 将保存按钮添加到按钮行
    remoteBtnRow.appendChild(remoteSaveBtn);
    
    remoteForm.append(enableRow, enableStatusText, providerRow, modelRow, apiKeyRow, baseUrlRow, paramsRow, remoteBtnRow, providerSaveStatusText);
    
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
    
    // Provider save handler
    remoteSaveBtn.addEventListener("click", async () => {
        const config = {
            enabled: enableCheckbox.checked,
            provider: providerSelect.value,
            model: modelInput.value,
            api_key: apiKeyInput.value,
            base_url: baseUrlInput.value,
            max_tokens: parseInt(maxTokensInput.value) || 500,
            timeout: parseInt(timeoutInput.value) || 60,
            temperature: parseFloat(temperatureInput?.value) || 0.0
        };
        
        const result = await window.NeoNodes?.saveRemoteLLMConfig?.(config);
        
        if (result && result.success) {
            remoteSaveBtn.textContent = "✅ Saved!";
            remoteSaveBtn.style.background = "#16a34a";
            remoteSaveBtn.style.color = "#fff";
            remoteSaveBtn.style.opacity = "1";
            
            providerSaveStatusText.textContent = "✅ Provider settings saved!";
            providerSaveStatusText.style.display = "block";
            providerSaveStatusText.style.color = "#16a34a";
            
            setTimeout(() => {
                remoteSaveBtn.textContent = "💾 Save Provider Settings";
                remoteSaveBtn.disabled = false;
                remoteSaveBtn.style.background = "#1a3a5a";
                remoteSaveBtn.style.color = "#60a5fa";
                remoteSaveBtn.style.opacity = "1";
                providerSaveStatusText.style.display = "none";
            }, 2000);
        } else {
            remoteSaveBtn.textContent = "❌ Failed";
            remoteSaveBtn.style.background = "#dc2626";
            remoteSaveBtn.style.color = "#fff";
            remoteSaveBtn.style.opacity = "1";
            
            providerSaveStatusText.textContent = "❌ Failed to save: " + (result?.error || "Unknown error");
            providerSaveStatusText.style.display = "block";
            providerSaveStatusText.style.color = "#dc2626";
            
            setTimeout(() => {
                remoteSaveBtn.textContent = "💾 Save Provider Settings";
                remoteSaveBtn.disabled = false;
                remoteSaveBtn.style.background = "#1a3a5a";
                remoteSaveBtn.style.color = "#60a5fa";
                remoteSaveBtn.style.opacity = "1";
                providerSaveStatusText.style.display = "none";
            }, 3000);
        }
    });
    
    // Provider info update
    providerSelect.addEventListener("change", () => {
        const localProviders = ["ollama", "lmstudio", "llamacpp", "vllm"];
        if (localProviders.includes(providerSelect.value)) {
            apiKeyInput.placeholder = "Optional for local services";
        } else {
            apiKeyInput.placeholder = "Required for cloud services";
        }
        
        if (providerSelect.value === "openai") {
            modelInput.placeholder = "e.g., gpt-4o-mini";
            if (!modelInput.value) modelInput.value = "gpt-4o-mini";
        } else if (providerSelect.value === "anthropic") {
            modelInput.placeholder = "e.g., claude-sonnet-4-20250514";
            if (!modelInput.value) modelInput.value = "claude-sonnet-4-20250514";
        } else if (providerSelect.value === "ollama") {
            modelInput.placeholder = "e.g., llama3";
            if (!modelInput.value) modelInput.value = "llama3";
            baseUrlInput.value = "http://localhost:11430";
        } else if (providerSelect.value === "lmstudio") {
            modelInput.placeholder = "e.g., qwen2.5";
            if (!modelInput.value) modelInput.value = "qwen2.5";
            baseUrlInput.value = "http://localhost:1234";
        } else if (providerSelect.value === "llamacpp") {
            modelInput.placeholder = "Enter model name";
            baseUrlInput.value = "http://localhost:8080";
        } else if (providerSelect.value === "vllm") {
            modelInput.placeholder = "Enter model name";
            baseUrlInput.value = "http://localhost:8000";
        } else if (providerSelect.value === "zhipu") {
            modelInput.placeholder = "e.g., glm-4";
            if (!modelInput.value) modelInput.value = "glm-4";
            baseUrlInput.value = "https://open.bigmodel.cn/api/proxy";
        } else if (providerSelect.value === "doubao") {
            modelInput.placeholder = "e.g., doubao-lite-128k";
            if (!modelInput.value) modelInput.value = "doubao-lite-128k";
        }
    });
    
    return { 
        modal, 
        modelList, 
        statusText, 
        closeBtn,
        enableCheckbox,
        providerSelect,
        modelInput,
        apiKeyInput,
        baseUrlInput,
        maxTokensInput,
        timeoutInput,
        temperatureInput,
        remoteSaveBtn,
        enableStatusText,
        providerSaveStatusText,
        localTabBtn,
        remoteTabBtn,
        localTabContent,
        remoteTabContent
    };
}

async function loadRemoteLLMConfig(settingsModal) {
    const config = await window.NeoNodes?.getRemoteLLMConfig?.();
    if (config) {
        settingsModal.enableCheckbox.checked = config.enabled || false;
        settingsModal.providerSelect.value = config.provider || 'openai';
        settingsModal.apiKeyInput.value = config.api_key === '***' ? '' : (config.api_key || '');
        settingsModal.maxTokensInput.value = config.max_tokens || 500;
        settingsModal.timeoutInput.value = config.timeout || 60;
        if (settingsModal.temperatureInput) {
            settingsModal.temperatureInput.value = config.temperature || 0.0;
        }
        if (config.model) {
            settingsModal.modelInput.value = config.model;
        }
        if (config.base_url) {
            settingsModal.baseUrlInput.value = config.base_url;
        }
        settingsModal.providerSelect.dispatchEvent(new Event('change'));
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
    
    const toggleKnob = mkEl("div", "rs-toggle-knob");
    
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
    root.appendChild(settingsModal.modal);

    presetListBody.style.scrollbarWidth = "thin";
    presetListBody.style.scrollbarColor = "#5090cc #1a1a1a";

    let pendingDeleteName = null;
    let context = null;
    let isLoading = false;
    let isListOpen = false;
    let isSettingsBtnClicked = false;

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

        // 点击外部时关闭 settings modal（但点击 modal 内部时不关闭）
        document.addEventListener("mousedown", (e) => {
            if (isSettingsBtnClicked) {
                isSettingsBtnClicked = false;
                return;
            }
            if (!settingsModal.modal.contains(e.target)) {
                settingsModal.modal.style.display = "none";
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
                return;
            }
            
            settingsModal.modal.classList.add("rs-positioned-right");
            
            let offsetParent = settingsBtn.offsetParent;
            
            let accumulatedTop = 0;
            let accumulatedLeft = 0;
            let currentEl = settingsBtn;
            
            while (currentEl && currentEl !== root) {
                accumulatedTop += currentEl.offsetTop || 0;
                accumulatedLeft += currentEl.offsetLeft || 0;
                currentEl = currentEl.offsetParent;
            }
            
            const topPos = accumulatedTop;
            const leftPos = accumulatedLeft + settingsBtn.offsetWidth + 5;
            
            settingsModal.modal.style.position = "absolute";
            settingsModal.modal.style.zIndex = "999999";
            settingsModal.modal.style.top = topPos + "px";
            settingsModal.modal.style.left = leftPos + "px";
            settingsModal.modal.style.transform = "none";
            settingsModal.modal.style.justifyContent = "flex-start";
            settingsModal.modal.style.alignItems = "flex-start";
            settingsModal.modal.style.opacity = "1";
            settingsModal.modal.style.visibility = "visible";
            
            settingsModal.modal.style.display = "flex";
            
            loadModelsIntoSettings();
            loadRemoteLLMConfig(settingsModal);
        });
        
        settingsModal.closeBtn.addEventListener("click", () => {
            settingsModal.modal.style.display = "none";
        });

        settingsModal.modal.addEventListener("click", (e) => {
            if (e.target === settingsModal.modal || e.target === settingsModal.wrapper) {
                settingsModal.modal.style.display = "none";
            }
        });

        // Global click handler to close modal when clicking outside
        document.addEventListener("click", (e) => {
            if (settingsModal.modal.style.display === "flex" &&
                !settingsModal.modal.contains(e.target) &&
                !settingsBtn.contains(e.target)) {
                settingsModal.modal.style.display = "none";
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