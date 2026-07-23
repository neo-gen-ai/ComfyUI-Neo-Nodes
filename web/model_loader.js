// UNetLoader With Prefix Filter
import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "comfyui-unetloader-filter",
    
    async beforeRegisterNodeDef(nodeType, nodeData) {
        
        // 只处理我们的节点
        const targetNodes = [
            "UNetLoaderWithPrefix",
            "CheckpointLoaderWithPrefix", 
            "LoraLoaderWithPrefix"
        ];
        
        if (!targetNodes.includes(nodeData.name)) {
            return;
        }
        
        // 获取文件 widget 名称
        let fileWidgetName;
        switch (nodeData.name) {
            case "UNetLoaderWithPrefix":
                fileWidgetName = "unet_name";
                break;
            case "CheckpointLoaderWithPrefix":
                fileWidgetName = "ckpt_name";
                break;
            case "LoraLoaderWithPrefix":
                fileWidgetName = "lora_name";
                break;
            default:
                return;
        }
        
        // 从 nodeData 中获取原始文件列表
        const fileInputDef = nodeData.input.required[fileWidgetName];
        
        // 提取文件列表 - 确保始终是数组
        let originalFileValues = [];
        if (Array.isArray(fileInputDef)) {
            if (fileInputDef.length >= 2 && Array.isArray(fileInputDef[1])) {
                originalFileValues = fileInputDef[1];
            } else if (fileInputDef.length >= 1) {
                originalFileValues = Array.isArray(fileInputDef[0]) ? fileInputDef[0] : [];
            }
        }
        
        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        
        nodeType.prototype.onNodeCreated = function() {
            const result = originalOnNodeCreated?.apply(this, arguments);
            
            const node = this;
            
            const directoryWidget = node.widgets?.find(w => w.name === "model_directory");
            const fileWidget = node.widgets?.find(w => w.name === fileWidgetName);
            
            if (!directoryWidget || !fileWidget) {
                console.warn(`ComfyUI-Neo-Nodes: Missing widgets for ${nodeData.name}`);
                return result;
            }
            
            const widgetFiles = fileWidget.values || fileWidget.options?.values || [];
            const allFiles = originalFileValues.length > 0 ? originalFileValues : widgetFiles;
            
            node._allFiles = [...allFiles];
            
            const normalizePath = (path) => path.replace(/\\/g, '/');
            
            const updateFileList = (selectedDirectory) => {
                
                let filteredFiles;
                let stripPrefix = '';
                
                if (!selectedDirectory || selectedDirectory === "__all__") {
                    filteredFiles = node._allFiles;
                } else {
                    stripPrefix = normalizePath(selectedDirectory) + '/';
                    
                    filteredFiles = node._allFiles.filter(file => {
                        return normalizePath(file).startsWith(stripPrefix);
                    });
                }
                
                const displayFiles = filteredFiles.map(file => {
                    const normalized = normalizePath(file);
                    if (stripPrefix && normalized.startsWith(stripPrefix)) {
                        return normalized.slice(stripPrefix.length);
                    }
                    return file;
                });
                
                fileWidget.values = displayFiles;
                
                if (fileWidget.options) {
                    fileWidget.options.values = displayFiles;
                }
                
                if (filteredFiles.length > 0) {
                    fileWidget.value = displayFiles[0];
                }
                
                if (node.computeSize) {
                    node.computeSize();
                }
                if (node.onDrawForeground) {
                    node.onDrawForeground();
                }
                if (node.graph) {
                    node.graph.setDirtyCanvas(true, true);
                }
                
            };
            
            const directoryElement = directoryWidget.element;
            
            if (directoryElement && directoryElement.tagName === 'SELECT') {
                const handleChange = (e) => {
                    const selectedDirectory = e.target.value;
                    updateFileList(selectedDirectory);
                };
                directoryElement.addEventListener('change', handleChange);
            }
            
            const originalCallback = directoryWidget.callback;
            directoryWidget.callback = function(value) {
                updateFileList(value);
                if (originalCallback) {
                    originalCallback(value);
                }
            };
            
            setTimeout(() => {
                const currentDirectory = directoryWidget.value || "__all__";
                updateFileList(currentDirectory);
            }, 300);
            
            return result;
        };
    }
});