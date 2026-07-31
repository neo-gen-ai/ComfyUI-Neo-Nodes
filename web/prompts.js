/**
 * prompts.js
 * 主入口 - 节点注册、生命周期、增强/翻译
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { mkEl, createPromptManagerUI, createSettingsModal, loadRemoteLLMConfig } from "./prompt-manager.js";
import { 
    enhancePrompt, translatePrompt, randomPrompt as randomPromptAPI, 
    checkModelAndPrompt, downloadModel, showDownloadModal, monitorDownloadProgress,
    getAvailableModels, checkAllModels, checkModel, setCurrentModel
} from "./prompt-service.js";

// 导入 promptService（从 prompt-service.js）
import promptService from "./prompt-service.js";

// 导入 NodeBehaviors
import NodeBehaviors from "./node-behavior.js";

// ==========================================
// 共享的节点生命周期处理器工厂
// ==========================================

/**
 * 创建通用的 onConfigure 处理器
 */
function createOnConfigureHandler(node, promptUI) {
    return function(data) {
        if (this.widgets) {
            const disableWidget = this.widgets.find(w => w.name === "disable_text_input");
            if (disableWidget && this.properties?.rs_disable_state !== undefined) {
                disableWidget.value = this.properties.rs_disable_state;
            }
        }
        if (this.widgets) {
            const uidWidget = this.widgets.find(w => w.name === "instance_uid");
            if (uidWidget && this.properties?.rs_instance_uid !== undefined) {
                uidWidget.value = this.properties.rs_instance_uid;
            }
        }
        setTimeout(() => {
            if (this.restoreFromProperties) {
                this.restoreFromProperties();
            }
        }, 100);
    };
}

/**
 * 创建通用的 serialize 处理器
 */
function createSerializeHandler() {
    return function() {
        if (this.properties && this.widgets) {
            const uidWidget = this.widgets.find(w => w.name === "instance_uid");
            if (uidWidget && uidWidget.value) {
                this.properties.rs_instance_uid = uidWidget.value;
            }
        }
        if (this.widgets) {
            const disableWidget = this.widgets.find(w => w.name === "disable_text_input");
            if (disableWidget && this.properties) {
                this.properties.rs_disable_state = disableWidget.value;
            }
        }
    };
}

/**
 * 创建通用的 restoreFromProperties 处理器
 */
function createRestoreHandler(node, textWidget, customTextarea) {
    return function() {
        const instanceUid = NodeBehaviors.getInstanceUid(node);
        const textKey = NodeBehaviors.getTextKey(instanceUid);
        const savedText = localStorage.getItem(textKey);
        if (savedText !== null) {
            if (customTextarea) customTextarea.value = savedText;
            if (textWidget) textWidget.value = savedText;
        }
    };
}

/**
 * 创建通用的初始化处理器（设置基本属性）
 */
function createBasicNodeInitializer(node, instanceUid) {
    return function() {
        if (!node.properties) {
            node.properties = {};
        }
        if (node.properties.rs_disable_state === undefined) {
            node.properties.rs_disable_state = false;
        }
        if (node.properties.rs_waiting_prompt === undefined) {
            node.properties.rs_waiting_prompt = "";
        }
        if (node.properties.rs_waiting_timestamp === undefined) {
            node.properties.rs_waiting_timestamp = 0;
        }
    };
}


// ==========================================
// NeoPromptGenerator Node Extension
// A simple prompt generator node - same as NeoPromptEncoder but without statusbar/toggle
// Only outputs STRING (the prompt text)
// ==========================================
app.registerExtension({
    name: "NeoPromptGenerator",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "NeoPromptGenerator") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        const origOnConfigure = nodeType.prototype.onConfigure;
        const origSerialize = nodeType.prototype.serialize;
        const origOnRemoved = nodeType.prototype.onRemoved;

        const _origOnConfigure = origOnConfigure || function() {};
        const _origSerialize = origSerialize || function() { return {}; };
        const _origOnRemoved = origOnRemoved;

        nodeType.prototype.onConfigure = function(data) {
            const result = _origOnConfigure.apply(this, arguments);
            const node = this;
            
            if (this.widgets) {
                const uidWidget = this.widgets.find(w => w.name === "instance_uid");
                if (uidWidget && this.properties?.rs_instance_uid !== undefined) {
                    uidWidget.value = this.properties.rs_instance_uid;
                }
            }
            setTimeout(() => {
                if (this.restoreFromProperties) this.restoreFromProperties();
            }, 100);
            return result;
        };

        nodeType.prototype.serialize = function() {
            const node = this;
            if (node.properties && node.widgets) {
                const uidWidget = node.widgets.find(w => w.name === "instance_uid");
                if (uidWidget && uidWidget.value) node.properties.rs_instance_uid = uidWidget.value;
            }
            return _origSerialize.apply(this, arguments);
        };

        nodeType.prototype.onNodeCreated = function() {
            const result = origOnNodeCreated?.apply(this, arguments);
            const node = this;

            NodeBehaviors.createBasicNodeInitializer(node)();

            let instanceUid = NodeBehaviors.getInstanceUid(node);
            node.properties.rs_instance_uid = instanceUid;

            // Create prompt manager UI FIRST
            const promptUI = createPromptManagerUI();
            const root = promptUI.root;

            // Add the custom DOM widget - this will contain all visible UI elements
            node.addDOMWidget("prompt_ui", "custom", root);

            // Get textWidget reference BEFORE hiding other widgets
            const textWidget = node.widgets?.find(w => w.name === "prompt");
            
            // Hide specific default ComfyUI widgets only (not prompt_ui which is our container)
            const uidWidget = node.widgets?.find(w => w.name === "instance_uid");
            if (uidWidget) {
                uidWidget.value = instanceUid;
                uidWidget.serializeValue = () => node.properties.rs_instance_uid;
                uidWidget.hidden = true;
            }

            // Hide the prompt STRING widget
            if (textWidget) {
                textWidget.hidden = true;
                if (textWidget.element) textWidget.element.style.display = 'none';
                if (textWidget.inputEl) textWidget.inputEl.style.display = 'none';
            }
            node.setSize([370, 280]);
            node.minWidth = 370;
            node.minHeight = 260;

            // Initialize prompt manager - get UI elements and settings button
            // Pass textWidget so save handler can read current prompt text for AI extraction
            const { 
                enhanceBtn, translateBtn, generateBtn, randomBtn, quickInput, 
                customTextarea, statusBar, settingsBtn,
                presetListOverlay, presetNameInput, deleteConfirmOverlay, downloadModal,
                settingsModal, loadModelsIntoSettings,
                quickInputWrapper
            } = promptUI.init({ node, graph: node.graph, textWidget });

            // Hide status bar for NeoPromptGenerator
            if (statusBar) {
                statusBar.style.display = "none";
            }

            // Node lifecycle management
            const behaviorManager = NodeBehaviors.createNodeBehaviorManager();

            // Save references for cleanup
            node._promptUIElements = { presetListOverlay, presetNameInput, deleteConfirmOverlay };

            // NeoPromptGenerator UI update function (simplified - no toggle/statusBar)
            const updateStatusAndUI = () => {
                enhanceBtn.disabled = false;
                enhanceBtn.style.opacity = "1";
                translateBtn.disabled = false;
                translateBtn.style.opacity = "1";
                customTextarea.style.border = "1px solid #444";

                // Always show LOCAL PROMPT theme (no external input toggle)
                root.classList.remove("rs-theme-external");
                root.classList.add("rs-theme-local");

                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };


            // Node removal cleanup
            node.onRemoved = function() {
                behaviorManager.stopEnforcement(node);
                presetListOverlay.remove();
                presetNameInput.remove();
                deleteConfirmOverlay.remove();
                _origOnRemoved?.apply(this, arguments);
            };

            // Restore logic - use shared method
            node.restoreFromProperties = () => {
                NodeBehaviors.restoreTextFromStorage(node, textWidget, customTextarea);
                updateStatusAndUI();
            };

            // Initialize
            setTimeout(() => {
                NodeBehaviors.restoreTextFromStorage(node, textWidget, customTextarea);
                behaviorManager.startEnforcement(node);
                updateStatusAndUI();
            }, 100);

            // Text input event - use shared method
            customTextarea.addEventListener("input", () => {
                if (textWidget) textWidget.value = customTextarea.value;
                NodeBehaviors.saveTextToStorage(node, textWidget, customTextarea);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            });

            // ==========================================
            // Use shared button handlers (same as NeoPrompts)
            // ==========================================
            const promptUIRef = { 
                enhanceBtn, translateBtn, generateBtn, randomBtn, quickInput, 
                customTextarea, textWidget, node, graph: node.graph, downloadModal, statusBar: null 
            };
            
            enhanceBtn.addEventListener("click", NodeBehaviors.createEnhanceHandler(promptUIRef, promptService));
            translateBtn.addEventListener("click", NodeBehaviors.createTranslateHandler(promptUIRef, promptService));
            
            const handleGeneratePrompt = NodeBehaviors.createGenerateHandler(
                { ...promptUIRef, quickInput }, promptService);
            generateBtn.addEventListener("click", handleGeneratePrompt);
            quickInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") { e.preventDefault(); handleGeneratePrompt(); }
            });

            randomBtn.addEventListener("click", NodeBehaviors.createRandomHandler(promptUIRef, promptService));

            // ==========================================
            // Use shared event listeners
            // ==========================================
            document.addEventListener("click", NodeBehaviors.createPopupCloser({
                presetListOverlay, presetNameInput, deleteConfirmOverlay, saveBtn: null, listBtn: null, quickInputWrapper
            }));

            api.addEventListener("rs.prompt.update", NodeBehaviors.createPromptUpdateHandler(
                { customTextarea, textWidget, node, graph: node.graph }
            ));

            window.addEventListener("beforeunload", NodeBehaviors.createBeforeUnloadHandler(node, textWidget));

            // Expose node reference for external apps (like gallery)
            node._rsPromptUIElements = { customTextarea, textWidget };

            return result;
        };
    }
});

// ==========================================
// Listen for gallery prompt send events
// ==========================================
let _sentPromptCount = 0;

// Use document.addEventListener to receive events from gallery
document.addEventListener("gallery.send.prompt", (event) => {
    const { prompt, nodeIds } = event.detail;
    if (!prompt) return;

    console.log('[gallery.send.prompt] Received event:', { prompt, nodeIds });

    // If nodeIds specified, send to those nodes only
    if (nodeIds && nodeIds.length > 0) {
        for (const nodeId of nodeIds) {
            const node = app.graph.getNodeById(nodeId);
            console.log('[gallery.send.prompt] Looking for node:', nodeId, 'found:', node);
            if (node && node._rsPromptUIElements) {
                const { customTextarea, textWidget } = node._rsPromptUIElements;
                if (customTextarea) {
                    customTextarea.value = prompt;
                    if (textWidget) textWidget.value = prompt;
                    // Trigger input event to update storage
                    customTextarea.dispatchEvent(new Event("input", { bubbles: true }));
                    console.log('[gallery.send.prompt] Sent to node', nodeId);
                }
            }
        }
        return;
    }

    // Otherwise, find the first available NeoPromptEncoder or NeoPromptGenerator node
    let sent = false;
    app.graph._nodes.forEach(node => {
        if (sent) return;
        if (node._rsPromptUIElements) {
            const { customTextarea, textWidget } = node._rsPromptUIElements;
            if (customTextarea) {
                customTextarea.value = prompt;
                if (textWidget) textWidget.value = prompt;
                customTextarea.dispatchEvent(new Event("input", { bubbles: true }));
                sent = true;
                console.log('[gallery.send.prompt] Sent to node', node.id);
            }
        }
    });

    if (!sent) {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(prompt);
    }
});

window.addEventListener("beforeunload", NodeBehaviors.createBeforeUnloadHandler);

// ==========================================
// Reference external CSS file
// ==========================================
const cssLink = document.createElement('link');
cssLink.rel = 'stylesheet';
cssLink.href = "/extensions/ComfyUI-Neo-Nodes/prompts.css";
document.head.appendChild(cssLink);

// ==========================================
// Main Node Logic for NeoPromptEncoder
// ==========================================

app.registerExtension({
    name: "NeoPromptEncoder",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "NeoPromptEncoder") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        const origOnConfigure = nodeType.prototype.onConfigure;
        const origSerialize = nodeType.prototype.serialize;
        const origOnRemoved = nodeType.prototype.onRemoved;

        const _origOnConfigure = origOnConfigure || function() {};
        const _origSerialize = origSerialize || function() { return {}; };
        const _origOnRemoved = origOnRemoved;

        // 重写 onConfigure - 共享逻辑
        nodeType.prototype.onConfigure = function(data) {
            const result = _origOnConfigure.apply(this, arguments);
            const node = this;

            if (this.properties?.rs_instance_uid && this.widgets) {
                const uidWidget = this.widgets.find(w => w.name === "instance_uid");
                if (uidWidget) uidWidget.value = this.properties.rs_instance_uid;
            }
            if (this.widgets) {
                const disableWidget = this.widgets.find(w => w.name === "disable_text_input");
                if (disableWidget && this.properties?.rs_disable_state !== undefined) {
                    disableWidget.value = this.properties.rs_disable_state;
                }
            }
            setTimeout(() => {
                if (this.restoreFromProperties) this.restoreFromProperties();
            }, 100);
            return result;
        };

        // 重写 serialize - 共享逻辑
        nodeType.prototype.serialize = function() {
            const node = this;
            if (node.properties && node.widgets) {
                const uidWidget = node.widgets.find(w => w.name === "instance_uid");
                if (uidWidget && uidWidget.value) node.properties.rs_instance_uid = uidWidget.value;
                const disableWidget = node.widgets.find(w => w.name === "disable_text_input");
                if (disableWidget && node.properties) node.properties.rs_disable_state = disableWidget.value;
            }
            return _origSerialize.apply(this, arguments);
        };

        // 重写 onNodeCreated
        nodeType.prototype.onNodeCreated = function() {
            const result = origOnNodeCreated?.apply(this, arguments);
            const node = this;

            NodeBehaviors.createBasicNodeInitializer(node)();

            let instanceUid = NodeBehaviors.getInstanceUid(node);
            node.properties.rs_instance_uid = instanceUid;

            if (node.properties.rs_disable_state === undefined) {
                const disableWidget = node.widgets?.find(w => w.name === "disable_text_input");
                node.properties.rs_disable_state = disableWidget ? disableWidget.value : false;
            }

            const textWidget = node.widgets?.find(w => w.name === "text");
            const disableWidget = node.widgets?.find(w => w.name === "disable_text_input");
            const uidWidget = node.widgets?.find(w => w.name === "instance_uid");

            if (uidWidget) {
                uidWidget.value = instanceUid;
                uidWidget.hidden = true;
                uidWidget.serializeValue = () => node.properties.rs_instance_uid;
            }
            if (textWidget) textWidget.hidden = true;
            if (disableWidget) {
                disableWidget.value = node.properties.rs_disable_state;
                disableWidget.hidden = true;
            }

            // 隐藏虚拟插槽
            const hidePhantomSlot = () => {
                if (node.inputs) {
                    const textInput = node.inputs.find(i => i.name === "text");
                    if (textInput) {
                        textInput.disabled = true;
                        textInput.color_on = "transparent";
                        textInput.color_off = "transparent";
                        textInput.pos = [-1000, -1000];
                    }
                }
            };
            setTimeout(hidePhantomSlot, 0);

            // 创建提示词管理 UI
            const promptUI = createPromptManagerUI();
            const root = promptUI.root;
            node.addDOMWidget("prompt_ui", "custom", root);
            node.setSize([370, 280]);
            node.minWidth = 370;
            node.minHeight = 260;

            // 初始化提示词管理器
            const { 
                enhanceBtn, translateBtn, generateBtn, randomBtn, quickInput, 
                customTextarea, statusBar, settingsBtn, toggleSwitch, toggleKnob,
                presetListOverlay, presetNameInput, deleteConfirmOverlay, downloadModal,
                settingsModal, loadModelsIntoSettings,
                quickInputWrapper
            } = promptUI.init({ node, graph: node.graph, textWidget });

            // 节点生命周期管理 - 使用共享的 behaviorManager
            const behaviorManager = NodeBehaviors.createNodeBehaviorManager();
            let enforcementInterval = null;
            let waitingOverlay = null;

            // NeoPromptEncoder 特有的功能
            const removeWaitingOverlay = () => {
                if (waitingOverlay && waitingOverlay.parentNode) {
                    waitingOverlay.remove();
                    waitingOverlay = null;
                }
            };

            const showWaitingOverlay = () => {
                removeWaitingOverlay();
                waitingOverlay = mkEl("div", "rs-waiting-overlay");
                const messageDiv = mkEl("div", "rs-waiting-message");
                messageDiv.innerHTML = `
                    <div style="color:#fbbf24; font-size:14px; margin-bottom:10px; font-weight:bold;">✏️ EDITING MODE</div>
                    <div style="color:#ccc; font-size:12px;">Edit the prompt below and click APPROVE</div>
                `;
                waitingOverlay.appendChild(messageDiv);
                const domWidget = node.domWidgets?.find(w => w.name === "prompt_ui");
                if (domWidget && domWidget.element) {
                    domWidget.element.appendChild(waitingOverlay);
                }
            };

            const hasTextInputConnection = () => {
                return node.inputs?.some(i => i.name === "text_input" && i.link !== null) || false;
            };

            // 保存引用用于清理
            node._promptUIElements = { presetListOverlay, presetNameInput, deleteConfirmOverlay };

            // NeoPromptEncoder 特有的 UI 更新函数（包含 toggle switch 逻辑）
            const updateStatusAndUI = (() => {
                const applyTheme = (isExternal) => {
                    if (isExternal) {
                        statusBar.style.background = "#1a2a4a";
                        statusBar.style.color = "#60a5fa";
                        const statusTextEl = statusBar.querySelector("span");
                        if (statusTextEl) statusTextEl.textContent = "🔵 EXTERNAL INPUT";
                        root.classList.remove("rs-theme-local");
                        root.classList.add("rs-theme-external");
                    } else {
                        statusBar.style.background = "#1a3a1a";
                        statusBar.style.color = "#4ade80";
                        const statusTextEl = statusBar.querySelector("span");
                        if (statusTextEl) statusTextEl.textContent = "🟢 LOCAL PROMPT";
                        root.classList.remove("rs-theme-external");
                        root.classList.add("rs-theme-local");
                    }
                };

                return () => {
                    const isDisabled = node.properties.rs_disable_state;
                    removeWaitingOverlay();

                    enhanceBtn.disabled = false;
                    enhanceBtn.style.opacity = "1";
                    translateBtn.disabled = false;
                    translateBtn.style.opacity = "1";
                    customTextarea.style.border = "1px solid #444";

                    applyTheme(!isDisabled);

                    if (toggleSwitch && toggleKnob) {
                        if (isDisabled) {
                            // LOCAL PROMPT: toggle OFF (knob left, gray background)
                            toggleSwitch.style.background = "#3a3a3a";
                            toggleSwitch.style.borderColor = "#555";
                            toggleKnob.style.transform = "translateX(0)";
                            toggleKnob.style.background = "#999";
                        } else {
                            // EXTERNAL INPUT: toggle ON (knob right, theme color background)
                            toggleSwitch.style.background = "#4a4a4a";
                            toggleSwitch.style.borderColor = "#666";
                            toggleKnob.style.transform = "translateX(12px)";
                            toggleKnob.style.background = "#fff";
                        }
                    }

                    if (node.graph) node.graph.setDirtyCanvas(true, true);
                };
            })();

            // 启动强制执行定时器（NeoPromptEncoder 特有：检查 disableWidget）
            const startEnforcement = () => {
                if (enforcementInterval) clearInterval(enforcementInterval);
                enforcementInterval = setInterval(() => {
                    let needsRedraw = false;
                    if (disableWidget && disableWidget.value !== node.properties.rs_disable_state) {
                        disableWidget.value = node.properties.rs_disable_state;
                        needsRedraw = true;
                    }
                    if (needsRedraw && node.graph) node.graph.setDirtyCanvas(true, true);
                }, 200);
            };

            const stopEnforcement = () => {
                if (enforcementInterval) {
                    clearInterval(enforcementInterval);
                    enforcementInterval = null;
                }
                behaviorManager.stopEnforcement(node);
            };

            // Toggle switch click handler - NeoPromptEncoder 特有功能
            if (toggleSwitch) {
                toggleSwitch.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const currentState = node.properties.rs_disable_state;
                    const newState = !currentState;

                    if (newState && !hasTextInputConnection()) {
                        const statusTextEl = statusBar.querySelector("span");
                        if (statusTextEl) {
                            statusTextEl.textContent = "⚠️ CONNECT text_input TO SWITCH";
                        }
                        statusBar.style.background = "#3a2a1a";
                        statusBar.style.color = "#fbbf24";
                        setTimeout(() => updateStatusAndUI(), 1500);
                        return;
                    }

                    node.properties.rs_disable_state = newState;
                    if (disableWidget) disableWidget.value = node.properties.rs_disable_state;
                    updateStatusAndUI();
                    if (node.graph) node.graph.setDirtyCanvas(true, true);
                });
            }


            // 节点移除清理
            node.onRemoved = function() {
                stopEnforcement();
                presetListOverlay.remove();
                presetNameInput.remove();
                deleteConfirmOverlay.remove();
                _origOnRemoved?.apply(this, arguments);
            };

            // 恢复逻辑 - 使用共享方法
            node.restoreFromProperties = () => {
                NodeBehaviors.restoreTextFromStorage(node, textWidget, customTextarea);
                updateStatusAndUI();
            };

            // 初始化
            setTimeout(() => {
                NodeBehaviors.restoreTextFromStorage(node, textWidget, customTextarea);

                if (disableWidget) {
                    const originalDisableCallback = disableWidget.callback;
                    disableWidget.callback = function(v) {
                        node.properties.rs_disable_state = v;
                        originalDisableCallback?.apply(this, arguments);
                        updateStatusAndUI();
                    };
                }

                startEnforcement();
                updateStatusAndUI();
            }, 100);

            // 文本输入事件 - 使用共享方法
            customTextarea.addEventListener("input", () => {
                if (textWidget) textWidget.value = customTextarea.value;
                NodeBehaviors.saveTextToStorage(node, textWidget, customTextarea);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            });

            // ==========================================
            // 使用共享的按钮处理器（与 NeoPromptGenerator 相同）
            // ==========================================
            const promptUIRef = {
                enhanceBtn, translateBtn, generateBtn, randomBtn, quickInput,
                customTextarea, textWidget, node, graph: node.graph, downloadModal, statusBar
            };

            enhanceBtn.addEventListener("click", NodeBehaviors.createEnhanceHandler(promptUIRef, promptService));
            translateBtn.addEventListener("click", NodeBehaviors.createTranslateHandler(promptUIRef, promptService));

            const handleGeneratePrompt = NodeBehaviors.createGenerateHandler(
                { ...promptUIRef, quickInput }, promptService);
            generateBtn.addEventListener("click", handleGeneratePrompt);
            quickInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") { e.preventDefault(); handleGeneratePrompt(); }
            });

            randomBtn.addEventListener("click", NodeBehaviors.createRandomHandler(promptUIRef, promptService));

            // ==========================================
            // Use shared event listeners
            // ==========================================
            document.addEventListener("click", NodeBehaviors.createPopupCloser({
                presetListOverlay, presetNameInput, deleteConfirmOverlay, saveBtn: null, listBtn: null, quickInputWrapper
            }));

            api.addEventListener("rs.prompt.update", NodeBehaviors.createPromptUpdateHandler(
                { customTextarea, textWidget, node, graph: node.graph }
            ));

            window.addEventListener("beforeunload", NodeBehaviors.createBeforeUnloadHandler(node, textWidget));

            // Expose node reference for external apps (like gallery)
            node._rsPromptUIElements = { customTextarea, textWidget };

            return result;
        };
    }
});
