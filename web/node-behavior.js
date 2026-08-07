/**
 * node-behavior.js
 * 共享的节点行为逻辑 - 消除 NeoPromptSimple 和 NeoPrompts 之间的代码重复
 */

import { checkModelAndPrompt, enhancePromptStream, translatePromptStream, smartPromptStream, randomPrompt } from "./prompt-service.js";

// ==========================================
// 工具函数
// ==========================================

/**
 * 获取实例 UID
 */
function getInstanceUid(node) {
    if (node.properties?.rs_instance_uid) {
        return node.properties.rs_instance_uid;
    }
    const uidWidget = node.widgets?.find(w => w.name === "instance_uid");
    if (uidWidget?.value) {
        return uidWidget.value;
    }
    return 'rs_inst_' + crypto.randomUUID().replace(/-/g, '');
}

/**
 * 获取文本键（用于 localStorage）
 */
function getTextKey(instanceUid) {
    return `rs_prompt_${instanceUid}`;
}

/**
 * 保存文本到 localStorage 和 widget
 */
/**
 * Set textarea value and dispatch synthetic "input" event (triggers auto-switch from EXTERNAL to LOCAL)
 */
function setTextAndTrigger(customTextarea, value) {
    if (!customTextarea) return;
    customTextarea.value = value;
    customTextarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function saveTextToStorage(node, textWidget, customTextarea, forceSave = false) {
    const instanceUid = getInstanceUid(node);
    const textKey = getTextKey(instanceUid);
    const text = customTextarea?.value ?? textWidget?.value ?? "";
    
    if (textWidget && (forceSave || textWidget.value !== text)) {
        textWidget.value = text;
    }
    if (customTextarea && customTextarea.value !== text) {
        customTextarea.value = text;
    }
    localStorage.setItem(textKey, text);
    return text;
}

/**
 * 从 localStorage 恢复文本
 */
function restoreTextFromStorage(node, textWidget, customTextarea) {
    const instanceUid = getInstanceUid(node);
    const textKey = getTextKey(instanceUid);
    const savedText = localStorage.getItem(textKey);
    
    if (savedText !== null) {
        if (textWidget) textWidget.value = savedText;
        if (customTextarea) customTextarea.value = savedText;
        return savedText;
    } else if (textWidget) {
        const initialText = textWidget.value || "";
        localStorage.setItem(textKey, initialText);
        if (customTextarea) customTextarea.value = initialText;
        return initialText;
    }
    return null;
}

/**
 * 创建通用的初始化处理器（设置基本属性）
 */
function createBasicNodeInitializer(node) {
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
// 按钮操作工厂函数
// ==========================================

/**
 * 创建增强提示词的处理函数
 */
function createEnhanceHandler(promptUI) {
    return async () => {
        const { enhanceBtn, customTextarea, textWidget, node, graph, downloadModal, statusBar } = promptUI;
        
        const currentText = customTextarea.value.trim();
        if (!currentText) {
            alert("Please enter a prompt first.");
            return;
        }

        const modelOk = await checkModelAndPrompt(downloadModal, statusBar);
        if (!modelOk) return;

        enhanceBtn.disabled = true;
        enhanceBtn.textContent = "⏳ Enhancing...";
        customTextarea.classList.add("rs-textarea-streaming");

        let rafId = null;
        try {
            let accumulated = "";
            await enhancePromptStream(currentText, {
                onChunk: (chunk) => {
                    if (chunk.text) {
                        accumulated += chunk.text;
                        if (!rafId) {
                            rafId = requestAnimationFrame(() => {
                                customTextarea.value = accumulated;
                                customTextarea.scrollTop = customTextarea.scrollHeight;
                                rafId = null;
                            });
                        }
                    }
                },
                onDone: () => {
                    if (rafId) cancelAnimationFrame(rafId);
                    if (textWidget) textWidget.value = accumulated;
                    saveTextToStorage(node, textWidget, customTextarea);
                    customTextarea.classList.remove("rs-textarea-streaming");
                },
                onError: (err) => {
                    console.error("Enhance stream error:", err);
                    alert("Failed to enhance prompt: " + err);
                    customTextarea.classList.remove("rs-textarea-streaming");
                }
            });
        } catch (e) {
            console.error("Network Error:", e);
            alert("Network error during enhancement.");
            customTextarea.classList.remove("rs-textarea-streaming");
        } finally {
            enhanceBtn.disabled = false;
            enhanceBtn.textContent = "✨ Enhance";
            customTextarea.classList.remove("rs-textarea-streaming");
        }
    };
}

/**
 * 创建翻译提示词的处理函数
 */
function createTranslateHandler(promptUI) {
    return async () => {
        const { translateBtn, customTextarea, textWidget, node, graph, downloadModal, statusBar } = promptUI;
        
        const currentText = customTextarea.value.trim();
        if (!currentText) {
            alert("Please enter a prompt first.");
            return;
        }

        const modelOk = await checkModelAndPrompt(downloadModal, statusBar);
        if (!modelOk) return;

        translateBtn.disabled = true;
        translateBtn.textContent = "⏳ Translating...";
        customTextarea.classList.add("rs-textarea-streaming");

        let rafId = null;
        try {
            let accumulated = "";
            await translatePromptStream(currentText, {
                onChunk: (chunk) => {
                    if (chunk.text) {
                        accumulated += chunk.text;
                        if (!rafId) {
                            rafId = requestAnimationFrame(() => {
                                customTextarea.value = accumulated;
                                customTextarea.scrollTop = customTextarea.scrollHeight;
                                rafId = null;
                            });
                        }
                    }
                },
                onDone: () => {
                    if (rafId) cancelAnimationFrame(rafId);
                    if (textWidget) textWidget.value = accumulated;
                    saveTextToStorage(node, textWidget, customTextarea);
                    customTextarea.classList.remove("rs-textarea-streaming");
                },
                onError: (err) => {
                    console.error("Translate stream error:", err);
                    alert("Failed to translate prompt: " + err);
                    customTextarea.classList.remove("rs-textarea-streaming");
                }
            });
        } catch (e) {
            console.error("Network Error:", e);
            alert("Network error during translation.");
            customTextarea.classList.remove("rs-textarea-streaming");
        } finally {
            translateBtn.disabled = false;
            translateBtn.textContent = "🌐 Translate";
            customTextarea.classList.remove("rs-textarea-streaming");
        }
    };
}

/**
 * 创建生成提示词的处理函数 - 使用 LLM 智能判断
 */
function createGenerateHandler(promptUI) {
    return async () => {
        const { generateBtn, quickInput, customTextarea, textWidget, node, graph, downloadModal, statusBar } = promptUI;
        
        const quickText = quickInput.value.trim();
        if (!quickText) {
            alert("Please enter a quick description first.");
            return;
        }

        // 获取当前提示词（如果有）
        const currentPrompt = customTextarea?.value?.trim() || "";

        const modelOk = await checkModelAndPrompt(downloadModal, statusBar);
        if (!modelOk) return;

        generateBtn.disabled = true;
        generateBtn.textContent = "⏳";

        let rafId = null;
        try {
            // 使用 LLM 智能判断（流式）：LLM 直接判断用户意图并生成/改写
            generateBtn.textContent = "🤖 Processing...";
            let accumulated = "";
            await smartPromptStream(currentPrompt, quickText, {
                onChunk: (chunk) => {
                    if (chunk.text) {
                        accumulated += chunk.text;
                        if (!rafId) {
                            rafId = requestAnimationFrame(() => {
                                customTextarea.value = accumulated;
                                customTextarea.scrollTop = customTextarea.scrollHeight;
                                rafId = null;
                            });
                        }
                    }
                },
                onDone: () => {
                    if (rafId) cancelAnimationFrame(rafId);
                    if (textWidget) textWidget.value = accumulated;
                    saveTextToStorage(node, textWidget, customTextarea);
                },
                onError: (err) => {
                    console.error("Smart prompt stream error:", err);
                    alert("Failed to process prompt: " + err);
                }
            });
        } catch (e) {
            console.error("Network Error:", e);
            alert("Network error during processing.");
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = "🚀";
        }
    };
}

/**
 * 创建随机生成提示词的处理函数（纯本地操作，不需要大模型）
 */
function createRandomHandler(promptUI) {
    return async () => {
        const { randomBtn, customTextarea, textWidget, node, graph } = promptUI;

        randomBtn.disabled = true;
        randomBtn.textContent = "⏳";

        try {
            const data = await randomPrompt();
            if (data.status === "success") {
                setTextAndTrigger(customTextarea, data.prompt);
                saveTextToStorage(node, textWidget, customTextarea);
                if (graph) graph.setDirtyCanvas(true, true);
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
    };
}

// ==========================================
// 事件监听器管理
// ==========================================

/**
 * 创建弹窗自动关闭的事件监听器
 */
function createPopupCloser(promptUIElements) {
    return (e) => {
        const { presetListOverlay, presetNameInput, deleteConfirmOverlay, saveBtn, quickInputWrapper } = promptUIElements;
        
        // Check if click is inside our custom UI root
        const clickedRoot = e.target.closest(".rs-root");
        
        if (presetListOverlay) {
            // 点击 overlay 内部不关闭
            if (presetListOverlay.contains(e.target)) {
                return;
            }
            // 点击 quickInputWrapper 内部（包括 quickInput、listBtn、randomBtn、generateBtn）不关闭
            if (quickInputWrapper && quickInputWrapper.contains(e.target)) {
                return;
            }
            // 点击外部（不在 rs-root 内）才关闭
            if (!clickedRoot) {
                presetListOverlay.style.display = "none";
            }
        }
        if (presetNameInput && !presetNameInput.contains(e.target)) {
            // Don't close if clicking inside the same rs-root or on the save button
            if (clickedRoot && (!saveBtn || !saveBtn.contains(e.target))) {
                presetNameInput.style.display = "none";
            }
        }
        if (deleteConfirmOverlay && !deleteConfirmOverlay.contains(e.target)) {
            // Don't close if clicking inside the same rs-root
            if (clickedRoot) {
                deleteConfirmOverlay.style.display = "none";
            }
        }
    };
}

/**
 * 创建处理 rs.prompt.update 事件的处理函数
 */
function createPromptUpdateHandler(promptUI) {
    return (event) => {
        const { customTextarea, textWidget, node, graph } = promptUI;
        const currentUid = getInstanceUid(node);
        
        if (event.detail.instance_uid === currentUid) {
            setTimeout(() => {
                customTextarea.value = event.detail.prompt;
                if (textWidget) {
                    textWidget.value = event.detail.prompt;
                    localStorage.setItem(getTextKey(currentUid), event.detail.prompt);
                }
                if (graph) graph.setDirtyCanvas(true, true);
            }, 10);
        }
    };
}

/**
 * 创建 beforeunload 事件处理函数
 */
function createBeforeUnloadHandler(node, textWidget) {
    return () => {
        if (textWidget?.value) {
            const currentUid = getInstanceUid(node);
            localStorage.setItem(getTextKey(currentUid), textWidget.value);
        }
        const disableWidget = node.widgets?.find(w => w.name === "disable_text_input");
        if (disableWidget) node.properties.rs_disable_state = disableWidget.value;
    };
}

// ==========================================
// 定时器管理
// ==========================================

/**
 * 创建节点行为管理器
 */
function createNodeBehaviorManager() {
    const intervals = new WeakMap();
    const timeouts = new WeakMap();
    
    /**
     * 启动强制执行定时器
     */
    function startEnforcement(node, updateStatusAndUI) {
        if (!intervals.has(node)) {
            const intervalId = setInterval(() => {
                let needsRedraw = false;
                const disableWidget = node.widgets?.find(w => w.name === "disable_text_input");
                
                if (disableWidget && disableWidget.value !== node.properties.rs_disable_state) {
                    disableWidget.value = node.properties.rs_disable_state;
                    needsRedraw = true;
                }
                
                if (needsRedraw && node.graph) {
                    node.graph.setDirtyCanvas(true, true);
                }
            }, 200);
            intervals.set(node, intervalId);
        }
    }
    
    /**
     * 停止强制执行定时器
     */
    function stopEnforcement(node) {
        const intervalId = intervals.get(node);
        if (intervalId) {
            clearInterval(intervalId);
            intervals.delete(node);
        }
        
        // 清理所有待执行的 timeout
        const timeIds = timeouts.get(node);
        if (timeIds) {
            timeIds.forEach(id => clearTimeout(id));
            timeouts.delete(node);
        }
    }
    
    /**
     * 注册定时器
     */
    function registerTimeout(node, fn, delay) {
        if (!timeouts.has(node)) {
            timeouts.set(node, []);
        }
        const timeId = setTimeout(() => {
            fn();
            const ids = timeouts.get(node);
            if (ids) {
                const idx = ids.indexOf(timeId);
                if (idx > -1) ids.splice(idx, 1);
            }
        }, delay);
        timeouts.get(node).push(timeId);
    }
    
    return { startEnforcement, stopEnforcement, registerTimeout };
}

// ==========================================
// 文本变更回调
// ==========================================

/**
 * 创建文本变更回调 - 当本地操作修改了 customText 时自动切换到 LOCAL PROMPT 状态
 */
function createOnTextChangeCallback(statusBar, updateStatusAndUI, node) {
    return function() {
        if (!statusBar) return;
        
        const statusTextEl = statusBar.querySelector("span");
        if (statusTextEl && statusTextEl.textContent.includes("EXTERNAL INPUT")) {
            // 自动切换到 LOCAL PROMPT 状态 - set rs_disable_state to true so updateStatusAndUI applies green theme
            if (node) node.properties.rs_disable_state = true;
            const disableWidget = node?.widgets?.find(w => w.name === "disable_text_input");
            if (disableWidget) disableWidget.value = true;
            
            // 自动切换状态并更新 UI
            if (updateStatusAndUI) updateStatusAndUI();
            
            // 显示切换提示
            statusTextEl.textContent = "⚡ Switched to LOCAL PROMPT";
            statusBar.style.background = "#1a3a1a";
            statusBar.style.color = "#4ade80";
            
            setTimeout(() => {
                if (statusTextEl) {
                    statusTextEl.textContent = "🟢 LOCAL PROMPT";
                }
                statusBar.style.background = "";
                statusBar.style.color = "";
            }, 1500);
        }
    };
}

// ==========================================
// 导出
// ==========================================

export const NodeBehaviors = {
    // 工具函数
    getInstanceUid,
    getTextKey,
    setTextAndTrigger,
    saveTextToStorage,
    restoreTextFromStorage,
    
    // 节点初始化器工厂
    createBasicNodeInitializer,
    
    // 按钮处理器工厂
    createEnhanceHandler,
    createTranslateHandler,
    createGenerateHandler,
    createRandomHandler,
    
    // 文本变更回调
    createOnTextChangeCallback,
    
    // 事件监听器
    createPopupCloser,
    createPromptUpdateHandler,
    createBeforeUnloadHandler,
    
    // 定时器管理
    createNodeBehaviorManager,
};

export default NodeBehaviors;
