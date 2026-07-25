/**
 * prompts.js
 * 主入口 - 节点注册、生命周期、增强/翻译
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { mkEl, createPromptManagerUI } from "./prompt-manager.js";
import { enhancePrompt, translatePrompt, generatePromptFromText, randomPrompt as randomPromptAPI, checkModelAndPrompt, downloadModel, showDownloadModal, monitorDownloadProgress } from "./prompt-service.js";

// ==========================================
// Reference external CSS file
// ==========================================
const cssLink = document.createElement('link');
cssLink.rel = 'stylesheet';
cssLink.href = "/extensions/ComfyUI-Neo-Nodes/prompts.css";
document.head.appendChild(cssLink);

// ==========================================
// Main Node Logic for NeoPrompts
// ==========================================

app.registerExtension({
    name: "NeoPrompts",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "NeoPrompts") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        const origOnConfigure = nodeType.prototype.onConfigure;
        const origSerialize = nodeType.prototype.serialize;
        const origOnRemoved = nodeType.prototype.onRemoved;

        // 重写 onConfigure
        nodeType.prototype.onConfigure = function (data) {
            const result = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;

            if (this.properties?.rs_instance_uid && this.widgets) {
                const uidWidget = this.widgets.find(w => w.name === "instance_uid");
                if (uidWidget) {
                    uidWidget.value = this.properties.rs_instance_uid;
                }
            }

            if (this.widgets) {
                const disableWidget = this.widgets.find(w => w.name === "disable_text_input");
                if (disableWidget && this.properties?.rs_disable_state !== undefined) {
                    disableWidget.value = this.properties.rs_disable_state;
                }
            }

            setTimeout(() => {
                if (this.restoreFromProperties) {
                    this.restoreFromProperties();
                }
            }, 100);

            return result;
        };

        // 重写 serialize
        nodeType.prototype.serialize = function () {
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

            const result = origSerialize ? origSerialize.apply(this, arguments) : {};
            return result;
        };

        // 重写 onNodeCreated
        nodeType.prototype.onNodeCreated = function () {
            const result = origOnNodeCreated?.apply(this, arguments);
            const node = this;

            if (!node.properties) {
                node.properties = {};
            }

            let instanceUid = node.properties.rs_instance_uid;
            if (!instanceUid) {
                const uidWidget = node.widgets?.find(w => w.name === "instance_uid");
                if (uidWidget && uidWidget.value) {
                    instanceUid = uidWidget.value;
                } else {
                    instanceUid = 'rs_inst_' + crypto.randomUUID().replace(/-/g, '');
                }
                node.properties.rs_instance_uid = instanceUid;
            }

            if (node.properties.rs_disable_state === undefined) {
                const disableWidget = node.widgets?.find(w => w.name === "disable_text_input");
                node.properties.rs_disable_state = disableWidget ? disableWidget.value : false;
            }
            if (node.properties.rs_waiting_prompt === undefined) {
                node.properties.rs_waiting_prompt = "";
            }
            if (node.properties.rs_waiting_timestamp === undefined) {
                node.properties.rs_waiting_timestamp = 0;
            }

            const textWidget = node.widgets?.find(w => w.name === "text");
            const disableWidget = node.widgets?.find(w => w.name === "disable_text_input");
            const uidWidget = node.widgets?.find(w => w.name === "instance_uid");

            if (uidWidget) {
                uidWidget.value = instanceUid;
                uidWidget.hidden = true;
                uidWidget.serializeValue = () => node.properties.rs_instance_uid;
            }
            if (textWidget) {
                textWidget.hidden = true;
            }
            if (disableWidget) {
                disableWidget.value = node.properties.rs_disable_state;
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

            let waitingOverlay = null;
            let enforcementInterval = null;

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
                    <div style="color:#888; font-size:10px; margin-top:8px;">⏳ Waiting for your decision...</div>
                `;
                waitingOverlay.appendChild(messageDiv);
                const domWidget = node.domWidgets?.find(w => w.name === "prompt_ui");
                if (domWidget && domWidget.element) {
                    domWidget.element.appendChild(waitingOverlay);
                }
            };

            // 创建提示词管理 UI - 内聚到 prompt-manager
            const promptUI = createPromptManagerUI();
            node.addDOMWidget("prompt_ui", "custom", promptUI.root);
            node.setSize([370, 350]);
            node.min_height = 350;
            node.min_width = 370;

            // 初始化提示词管理器
            const { 
                enhanceBtn, translateBtn, generateBtn, randomBtn, quickInput, 
                customTextarea, statusBar, settingsBtn,
                presetListOverlay, presetNameInput, deleteConfirmOverlay, downloadModal,
                settingsModal
            } = promptUI.init({
                node,
                graph: node.graph,
                textWidget
            });


            // 节点生命周期
            const origOnResize = node.onResize;
            node.onResize = function (size) {
                if (origOnResize) origOnResize.apply(this, [size]);
                if (size[0] < 370) size[0] = 370;
                if (size[1] < 350) size[1] = 350;
            };

            const hasTextInputConnection = () => {
                return node.inputs?.some(i => i.name === "text_input" && i.link !== null) || false;
            };

            const origOnConnectionsChange = node.onConnectionsChange;
            node.onConnectionsChange = function (slotType, slotIndex, isConnected, link, linkInfo) {
                if (origOnConnectionsChange) origOnConnectionsChange.apply(this, arguments);
                updateStatusAndUI();
            };

            const updateStatusAndUI = () => {
                const isDisabled = node.properties.rs_disable_state;
                const hasConnection = hasTextInputConnection();
                removeWaitingOverlay();

                enhanceBtn.disabled = false;
                enhanceBtn.style.opacity = "1";
                enhanceBtn.style.cursor = "pointer";
                translateBtn.disabled = false;
                translateBtn.style.opacity = "1";
                translateBtn.style.cursor = "pointer";
                customTextarea.style.border = "1px solid #444";

                // 获取状态文字元素（避免用 innerHTML 覆盖整个状态栏）
                const statusTextEl = statusBar.querySelector("span");
                
                if (hasConnection && !isDisabled) {
                    statusBar.style.background = "#1a2a3a";
                    statusBar.style.color = "#60a5fa";
                    if (statusTextEl) statusTextEl.textContent = "🔵 EXTERNAL INPUT";
                } else {
                    statusBar.style.background = "#1a3a1a";
                    statusBar.style.color = "#4ade80";
                    if (statusTextEl) statusTextEl.textContent = "🟢 LOCAL PROMPT";
                }

                // 确保设置按钮可见
                if (settingsBtn) {
                    settingsBtn.style.display = "flex";
                    settingsBtn.style.visibility = "visible";
                    settingsBtn.style.opacity = "1";
                }

                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };

            const startEnforcement = () => {
                if (enforcementInterval) clearInterval(enforcementInterval);
                enforcementInterval = setInterval(() => {
                    let needsRedraw = false;

                    if (disableWidget && disableWidget.value !== node.properties.rs_disable_state) {
                        disableWidget.value = node.properties.rs_disable_state;
                        needsRedraw = true;
                    }

                    if (needsRedraw && node.graph) {
                        node.graph.setDirtyCanvas(true, true);
                    }
                }, 200);
            };

            const stopEnforcement = () => {
                if (enforcementInterval) {
                    clearInterval(enforcementInterval);
                    enforcementInterval = null;
                }
            };

            node.onRemoved = function () {
                stopEnforcement();
                // 清理模态框
                presetListOverlay.remove();
                presetNameInput.remove();
                deleteConfirmOverlay.remove();
                if (origOnRemoved) origOnRemoved.apply(this, arguments);
            };

            node.restoreFromProperties = () => {
                const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                const textKey = `rs_prompt_${currentUid}`;
                const savedText = localStorage.getItem(textKey);
                if (savedText !== null) {
                    customTextarea.value = savedText;
                    if (textWidget) textWidget.value = savedText;
                }
                updateStatusAndUI();
            };

            const textKey = `rs_prompt_${instanceUid}`;

            setTimeout(() => {
                const savedText = localStorage.getItem(textKey);
                if (savedText !== null && textWidget) {
                    textWidget.value = savedText;
                    customTextarea.value = savedText;
                } else if (textWidget) {
                    const initialText = textWidget.value || "";
                    localStorage.setItem(textKey, initialText);
                    customTextarea.value = initialText;
                }

                if (disableWidget) {
                    const originalDisableCallback = disableWidget.callback;
                    disableWidget.callback = function (v) {
                        node.properties.rs_disable_state = v;
                        if (originalDisableCallback) originalDisableCallback(v);
                        updateStatusAndUI();
                    };
                }

                startEnforcement();
                updateStatusAndUI();
            }, 100);

            customTextarea.addEventListener("input", () => {
                if (textWidget) {
                    textWidget.value = customTextarea.value;
                    const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                    const currentTextKey = `rs_prompt_${currentUid}`;
                    localStorage.setItem(currentTextKey, customTextarea.value);
                }
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            });

            // ==========================================
            // 增强按钮
            // ==========================================
            enhanceBtn.addEventListener("click", async () => {
                const currentText = customTextarea.value.trim();
                if (!currentText) {
                    alert("Please enter a prompt first.");
                    return;
                }

                // 检查模型是否已下载
                const modelOk = await checkModelAndPrompt(downloadModal, statusBar);
                if (!modelOk) {
                    return;
                }

                enhanceBtn.disabled = true;
                enhanceBtn.textContent = "⏳ Enhancing...";

                try {
                    const data = await enhancePrompt(currentText);

                    if (data.status === "success") {
                        const enhancedText = data.enhanced;
                        customTextarea.value = enhancedText;
                        if (textWidget) {
                            textWidget.value = enhancedText;
                            const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                            localStorage.setItem(`rs_prompt_${currentUid}`, enhancedText);
                        }

                        if (node.graph) node.graph.setDirtyCanvas(true, true);
                    } else {
                        console.error("Enhance failed:", data);
                        alert("Failed to enhance prompt: " + (data.error || "Unknown error"));
                    }
                } catch (e) {
                    console.error("Network Error:", e);
                    alert("Network error during enhancement.");
                } finally {
                    enhanceBtn.disabled = false;
                    enhanceBtn.textContent = "✨ Enhance";
                }
            });

            // ==========================================
            // 翻译按钮
            // ==========================================
            translateBtn.addEventListener("click", async () => {
                const currentText = customTextarea.value.trim();
                if (!currentText) {
                    alert("Please enter a prompt first.");
                    return;
                }

                // 检查模型是否已下载
                const modelOk = await checkModelAndPrompt(downloadModal, statusBar);
                if (!modelOk) {
                    return;
                }

                translateBtn.disabled = true;
                translateBtn.textContent = "⏳ Translating...";

                try {
                    const data = await translatePrompt(currentText);

                    if (data.status === "success") {
                        const translatedText = data.translated;
                        customTextarea.value = translatedText;
                        if (textWidget) {
                            textWidget.value = translatedText;
                            const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                            localStorage.setItem(`rs_prompt_${currentUid}`, translatedText);
                        }

                        if (node.graph) node.graph.setDirtyCanvas(true, true);
                    } else {
                        console.error("Translate failed:", data);
                        alert("Failed to translate prompt: " + (data.error || "Unknown error"));
                    }
                } catch (e) {
                    console.error("Network Error:", e);
                    alert("Network error during translation.");
                } finally {
                    translateBtn.disabled = false;
                    translateBtn.textContent = "🌐 Translate";
                }
            });

            // ==========================================
            // 生成提示词 - 共用处理函数
            // ==========================================
            const handleGeneratePrompt = async () => {
                const quickText = quickInput.value.trim();
                if (!quickText) {
                    alert("Please enter a quick description first.");
                    return;
                }

                // 检查模型是否已下载
                const modelOk = await checkModelAndPrompt(downloadModal, statusBar);
                if (!modelOk) {
                    return;
                }

                generateBtn.disabled = true;
                generateBtn.textContent = "⏳";

                try {
                    const data = await generatePromptFromText(quickText);

                    if (data.status === "success") {
                        const generatedPrompt = data.prompt;
                        customTextarea.value = generatedPrompt;
                        if (textWidget) {
                            textWidget.value = generatedPrompt;
                            const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                            localStorage.setItem(`rs_prompt_${currentUid}`, generatedPrompt);
                        }

                        if (node.graph) node.graph.setDirtyCanvas(true, true);
                    } else {
                        console.error("Generate failed:", data);
                        alert("Failed to generate prompt: " + (data.error || "Unknown error"));
                    }
                } catch (e) {
                    console.error("Network Error:", e);
                    alert("Network error during generation.");
                } finally {
                    generateBtn.disabled = false;
                    generateBtn.textContent = "🚀";
                }
            };

            generateBtn.addEventListener("click", handleGeneratePrompt);

            // 快捷输入框支持回车生成
            quickInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    handleGeneratePrompt();
                }
            });

            // ==========================================
            // 随机生成按钮
            // ==========================================
            randomBtn.addEventListener("click", async () => {
                // 检查模型是否已下载
                const modelOk = await checkModelAndPrompt(downloadModal, statusBar);
                if (!modelOk) {
                    return;
                }

                randomBtn.disabled = true;
                randomBtn.textContent = "⏳";

                try {
                    const data = await randomPromptAPI();

                    if (data.status === "success") {
                        const randomPromptText = data.prompt;
                        customTextarea.value = randomPromptText;
                        if (textWidget) {
                            textWidget.value = randomPromptText;
                            const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                            localStorage.setItem(`rs_prompt_${currentUid}`, randomPromptText);
                        }

                        if (node.graph) node.graph.setDirtyCanvas(true, true);
                    } else {
                        console.error("Random prompt failed:", data);
                        alert("Failed to generate random prompt: " + (data.error || "Unknown error"));
                    }
                } catch (e) {
                    console.error("Network Error:", e);
                    alert("Network error during random prompt generation.");
                } finally {
                    randomBtn.disabled = false;
                    randomBtn.textContent = "🎲";
                }
            });

            // ==========================================
            // 事件监听 - 点击其他区域自动关闭弹窗
            // ==========================================
            document.addEventListener("click", (e) => {
                // 使用从 init 返回的模态框引用
                if (presetListOverlay && !presetListOverlay.contains(e.target)) {
                    const selectBtnEl = promptUI.root?.querySelector(".rs-btn-row .rs-btn:last-child");
                    if (selectBtnEl && !selectBtnEl.contains(e.target)) {
                        presetListOverlay.style.display = "none";
                    }
                }
                if (presetNameInput && !presetNameInput.contains(e.target)) {
                    const saveBtnEl = promptUI.root?.querySelector(".rs-btn-row .rs-btn:nth-child(3)");
                    if (saveBtnEl && e.target !== saveBtnEl) {
                        presetNameInput.style.display = "none";
                    }
                }
                if (deleteConfirmOverlay && !deleteConfirmOverlay.contains(e.target)) {
                    deleteConfirmOverlay.style.display = "none";
                }
            });

            api.addEventListener("rs.prompt.update", (event) => {
                const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                if (event.detail.instance_uid === currentUid) {
                    setTimeout(() => {
                        customTextarea.value = event.detail.prompt;
                        if (textWidget) {
                            textWidget.value = event.detail.prompt;
                            const currentTextKey = `rs_prompt_${instanceUid}`;
                            localStorage.setItem(currentTextKey, event.detail.prompt);
                        }
                        if (node.graph) node.graph.setDirtyCanvas(true, true);
                    }, 10);
                }
            });

            window.addEventListener("beforeunload", () => {
                if (textWidget && textWidget.value) {
                    const currentUid = node.properties.rs_instance_uid || node.widgets?.find(w => w.name === "instance_uid")?.value;
                    const currentTextKey = `rs_prompt_${currentUid}`;
                    localStorage.setItem(currentTextKey, textWidget.value);
                }
                if (disableWidget) node.properties.rs_disable_state = disableWidget.value;
            });

            return result;
        };
    }
});