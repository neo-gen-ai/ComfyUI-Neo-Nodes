/**
 * remote-llm-config.js
 * 远程 LLM 配置管理模块
 */

// ==========================================
// Provider 列表和默认配置
// ==========================================

const PROVIDERS = {
    openai: {
        name: "OpenAI",
        description: "GPT-4o, GPT-4o-mini, 自定义 OpenAI 兼容模型",
        defaultModel: "gpt-4o-mini",
        defaultBaseURL: "",
        supportsImages: true
    },
    anthropic: {
        name: "Anthropic (Claude)",
        description: "Claude Opus, Sonnet, Haiku",
        defaultModel: "claude-sonnet-4-20250514",
        defaultBaseURL: "https://api.anthropic.com",
        supportsImages: true
    },
    ollama: {
        name: "Ollama",
        description: "本地运行的 Ollama 服务",
        defaultModel: "llama3",
        defaultBaseURL: "http://localhost:11430",
        supportsImages: false
    },
    llamacpp: {
        name: "llama.cpp (server)",
        description: "本地运行的 llama.cpp HTTP server",
        defaultModel: "",
        defaultBaseURL: "http://localhost:8080",
        supportsImages: false
    },
    vllm: {
        name: "vLLM",
        description: "vLLM 推理服务",
        defaultModel: "",
        defaultBaseURL: "http://localhost:8000",
        supportsImages: false
    },
    zhipu: {
        name: "智谱 (Zhipu)",
        description: "GLM-4 等智谱模型",
        defaultModel: "glm-4-plus",
        defaultBaseURL: "https://open.bigmodel.cn/api/proxy",
        supportsImages: false
    },
    doubao: {
        name: "豆包 (Doubao)",
        description: "字节跳动豆包模型",
        defaultModel: "doubao-lite-128k",
        defaultBaseURL: "",
        supportsImages: false
    }
};

// ==========================================
// 配置模态框创建
// ==========================================

/**
 * 创建远程 LLM 配置模态框
 * @param {Object} options - 可选的配置初始值
 * @returns {Object} - 包含模态框元素和操作函数
 */
function createRemoteLLMConfigModal(options = {}) {
    // 创建模态框元素
    const modal = document.createElement('div');
    modal.className = 'rs-remote-llm-modal rs-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="rs-modal-backdrop"></div>
        <div class="rs-modal-content rs-settings-panel">
            <div class="rs-modal-header">
                <h3>🌐 Remote LLM Configuration</h3>
                <button class="rs-modal-close" title="Close">×</button>
            </div>
            <div class="rs-modal-body">
                <div class="rs-config-section">
                    <label class="rs-switch-container">
                        <input type="checkbox" id="rs-remote-enabled">
                        <span class="rs-switch-label">Enable Remote LLM</span>
                    </label>
                    <p class="rs-help-text">When enabled, all LLM tasks will use the remote API instead of local models.</p>
                </div>
                
                <div class="rs-config-section">
                    <label for="rs-remote-provider" class="rs-form-label">Provider</label>
                    <select id="rs-remote-provider" class="rs-form-input">
                        ${Object.entries(PROVIDERS).map(([key, val]) => 
                            `<option value="${key}">${val.name}</option>`
                        ).join('')}
                    </select>
                    <p class="rs-help-text">${PROVIDERS.openai.description}</p>
                </div>
                
                <div class="rs-config-section">
                    <label for="rs-remote-model" class="rs-form-label">Model</label>
                    <input type="text" id="rs-remote-model" class="rs-form-input" placeholder="e.g., gpt-4o-mini">
                    <p class="rs-help-text">The model to use for LLM tasks.</p>
                </div>
                
                <div class="rs-config-section">
                    <label for="rs-remote-api-key" class="rs-form-label">API Key</label>
                    <input type="password" id="rs-remote-api-key" class="rs-form-input" placeholder="Enter your API key">
                    <p class="rs-help-text">Your API key is stored locally and only used to connect to the provider.</p>
                </div>
                
                <div class="rs-config-section">
                    <label for="rs-remote-base-url" class="rs-form-label">Base URL (Optional)</label>
                    <input type="text" id="rs-remote-base-url" class="rs-form-input" placeholder="Leave empty for default">
                    <p class="rs-help-text">Custom API endpoint. Leave empty to use the provider's default.</p>
                </div>
                
                <div class="rs-config-row">
                    <div class="rs-config-section">
                        <label for="rs-remote-max-tokens" class="rs-form-label">Max Tokens</label>
                        <input type="number" id="rs-remote-max-tokens" class="rs-form-input" value="500" min="1" max="8192">
                    </div>
                    <div class="rs-config-section">
                        <label for="rs-remote-timeout" class="rs-form-label">Timeout (seconds)</label>
                        <input type="number" id="rs-remote-timeout" class="rs-form-input" value="60" min="10" max="300">
                    </div>
                </div>
                
                <div class="rs-config-section">
                    <label for="rs-remote-temperature" class="rs-form-label">Temperature: <span id="rs-temp-value">0.0</span></label>
                    <input type="range" id="rs-remote-temperature" class="rs-form-range" min="0" max="2" step="0.1" value="0.0">
                    <p class="rs-help-text">Controls randomness. 0 = deterministic, 2 = very creative.</p>
                </div>
                
                <div id="rs-provider-info" class="rs-provider-info"></div>
            </div>
            <div class="rs-modal-footer">
                <button class="rs-btn rs-btn-secondary" id="rs-llm-cancel">Cancel</button>
                <button class="rs-btn rs-btn-primary" id="rs-llm-save">Save Configuration</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 获取元素引用
    const elements = {
        modal,
        backdrop: modal.querySelector('.rs-modal-backdrop'),
        close: modal.querySelector('.rs-modal-close'),
        enabled: modal.querySelector('#rs-remote-enabled'),
        provider: modal.querySelector('#rs-remote-provider'),
        model: modal.querySelector('#rs-remote-model'),
        apiKey: modal.querySelector('#rs-remote-api-key'),
        baseUrl: modal.querySelector('#rs-remote-base-url'),
        maxTokens: modal.querySelector('#rs-remote-max-tokens'),
        timeout: modal.querySelector('#rs-remote-timeout'),
        temperature: modal.querySelector('#rs-remote-temperature'),
        tempValue: modal.querySelector('#rs-temp-value'),
        providerInfo: modal.querySelector('#rs-provider-info'),
        saveBtn: modal.querySelector('#rs-llm-save'),
        cancelBtn: modal.querySelector('#rs-llm-cancel')
    };
    
    // 更新提供商信息
    function updateProviderInfo() {
        const provider = elements.provider.value;
        const info = PROVIDERS[provider];
        if (info) {
            elements.providerInfo.innerHTML = `
                <div class="rs-info-box">
                    <strong>${info.name}</strong>: ${info.description}<br>
                    Default model: <code>${info.defaultModel || 'N/A'}</code> | 
                    Images: ${info.supportsImages ? '✅ Yes' : '❌ No'}
                </div>
            `;
            
            // 更新默认值和 placeholder
            if (!elements.model.value || elements.model.dataset.fromDefault) {
                elements.model.value = info.defaultModel || '';
                elements.model.placeholder = info.defaultModel || 'Enter model name';
            }
            if (!elements.baseUrl.value) {
                elements.baseUrl.value = info.defaultBaseURL || '';
                elements.baseUrl.placeholder = info.defaultBaseURL || 'Leave empty for default';
            }
        }
    }
    
    // 事件监听
    elements.provider.addEventListener('change', updateProviderInfo);
    elements.temperature.addEventListener('input', (e) => {
        elements.tempValue.textContent = e.target.value;
    });
    
    const closeModal = () => {
        modal.style.display = 'none';
    };
    
    elements.close.addEventListener('click', closeModal);
    elements.backdrop.addEventListener('click', closeModal);
    elements.cancelBtn.addEventListener('click', closeModal);
    
    elements.saveBtn.addEventListener('click', async () => {
        const config = {
            enabled: elements.enabled.checked,
            provider: elements.provider.value,
            model: elements.model.value,
            api_key: elements.apiKey.value,
            base_url: elements.baseUrl.value,
            max_tokens: parseInt(elements.maxTokens.value) || 500,
            timeout: parseInt(elements.timeout.value) || 60,
            temperature: parseFloat(elements.temperature.value) || 0.0
        };
        
        const result = await window.saveRemoteLLMConfig?.(config);
        if (result && result.success) {
            closeModal();
            alert('✅ Configuration saved successfully!');
        } else {
            alert('❌ Failed to save configuration: ' + (result?.error || 'Unknown error'));
        }
    });
    
    // 加载配置
    async function loadConfig() {
        const config = await window.getRemoteLLMConfig?.();
        if (config) {
            elements.enabled.checked = config.enabled || false;
            elements.provider.value = config.provider || 'openai';
            elements.model.value = config.model || '';
            elements.model.dataset.fromDefault = !config.model;
            elements.apiKey.value = config.api_key === '***' ? '' : (config.api_key || '');
            elements.baseUrl.value = config.base_url || '';
            elements.maxTokens.value = config.max_tokens || 500;
            elements.timeout.value = config.timeout || 60;
            elements.temperature.value = config.temperature || 0.0;
            elements.tempValue.textContent = config.temperature || 0.0;
            updateProviderInfo();
        }
    }
    
    return {
        modal,
        elements,
        open: async () => {
            await loadConfig();
            modal.style.display = 'flex';
        },
        close: closeModal
    };
}

// ==========================================
// 导出
// ==========================================

export {
    createRemoteLLMConfigModal,
    PROVIDERS
};