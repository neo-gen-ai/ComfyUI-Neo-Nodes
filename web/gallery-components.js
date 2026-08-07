/**
 * Gallery Components - UI building methods
 */
import { $el } from "../../../../scripts/ui.js";
import { api } from "../../../../scripts/api.js";
import {
    PAGE_SIZE,
    getReservedSpace,
    getImageHeight,
    getCardHeight,
    getCoverHeight,
    isImageFile,
    isVideoFile,
    getImageSrc,
    getVideoSrc,
    getThumbnailSrc,
    buildCoverGrid,
    createBreadcrumbItem,
    createBreadcrumbSeparator,
    createSpacer,
    sortByMtime,
    showNoFilesMessage,
    showLoadingOverlay,
    showToast,
    showInlineFeedback
} from './gallery-utils.js';

export class GalleryComponents {
    constructor(gallery) {
        this.gallery = gallery;
    }

    // ====== UI Builders ======

    createSearchInput(gallery) {
        const input = $el("input", {
            type: "text",
            placeholder: "Search prompt images...",
            className: "neo-gallery-search-input"
        });
        input.addEventListener("input", gallery.debounce(() => gallery.handleSearch(input.value), 300));
        return input;
    }

    createThumbnailSizeSlider(gallery) {
        const valueLabel = $el("span", {
            className: "thumbnail-size-value",
            textContent: `${gallery.maxThumbnailSize}px`
        });

        const slider = $el("input", {
            type: "range",
            min: gallery.constructor.THUMBNAIL_SIZE_MIN,
            max: gallery.constructor.THUMBNAIL_SIZE_MAX,
            step: gallery.constructor.THUMBNAIL_SIZE_STEP,
            value: gallery.maxThumbnailSize,
            className: "neo-gallery-thumbnail-slider",
            onchange: () => {
                const val = parseInt(slider.value);
                gallery.updateThumbnailSize(val);
                valueLabel.textContent = `${val}px`;
                gallery.savePluginData({ maxThumbnailSize: val });
            }
        });

        return $el("div", { className: "neo-gallery-slider-row" }, [
            $el("span", { className: "neo-gallery-size-label", textContent: "Size:" }),
            slider,
            valueLabel
        ]);
    }

    createCustomDirSettingBtn(gallery) {
        const btn = $el("button", {
            className: "neo-gallery-custom-dir-btn",
            title: "Set custom directory",
            onclick: async () => await gallery.promptAndSetCustomDir(),
            textContent: "+"
        });
        gallery.customDirSettingBtn = btn;
        return btn;
    }

    // ====== Directory Management Modal ======

    async buildDirModal(gallery) {
        // Remove existing modal and overlay if any
        const existingModal = document.querySelector('.neo-gallery-dir-modal');
        if (existingModal) existingModal.remove();
        const existingOverlay = document.querySelector('.neo-gallery-dir-modal-overlay');
        if (existingOverlay) existingOverlay.remove();

        let currentDirs = [];
        try {
            const resp = await api.fetchApi('/neo_gallery/get_settings');
            if (resp.ok) {
                const settings = await resp.json();
                const dirs = settings.custom_directories || [];
                if (Array.isArray(dirs)) {
                    currentDirs = [...dirs];
                } else if (settings.custom_directory) {
                    currentDirs = [settings.custom_directory];
                }
            }
        } catch (e) { }

        // Create modal overlay
        const modalOverlay = $el("div", {
            className: "neo-gallery-dir-modal-overlay",
            onclick: (e) => { if (e.target === modalOverlay) gallery.closeDirModal(); }
        });

        const modal = $el("div", { className: "neo-gallery-dir-modal" });

        // Title bar
        const titleBar = $el("div", { className: "neo-gallery-dir-modal-titlebar" }, [
            $el("span", { className: "neo-gallery-dir-modal-title", textContent: "\uD83D\uDCC1 Manage Directories" }),
            $el("span", {
                className: "neo-gallery-dir-modal-close",
                onclick: () => gallery.closeDirModal(),
                textContent: "\u00D7"
            })
        ]);

        // Directory list area
        const dirListContainer = $el("div", { className: "neo-gallery-dir-list-container" });

        if (currentDirs.length === 0) {
            dirListContainer.appendChild($el("div", {
                className: "neo-gallery-dir-empty",
                textContent: "No directories configured yet."
            }));
        } else {
            const dirItems = $el("div", { className: "neo-gallery-dir-items" });

            for (const dirPath of currentDirs) {
                const item = $el("div", { className: "neo-gallery-dir-item" }, [
                    $el("span", {
                        className: "neo-gallery-dir-path",
                        textContent: dirPath,
                        title: dirPath
                    }),
                    $el("button", {
                        className: "neo-gallery-dir-remove-btn",
                        onclick: async (e) => {
                            e.stopPropagation();
                            await gallery.removeCustomDir(dirPath);
                            setTimeout(() => gallery.promptAndSetCustomDir(), 300);
                        },
                        textContent: "\u2715"
                    })
                ]);
                dirItems.appendChild(item);
            }

            dirListContainer.appendChild(dirItems);
        }

        // Add new directory input area
        const addArea = $el("div", { className: "neo-gallery-dir-add-area" }, [
            $el("input", {
                type: "text",
                id: "neo-gallery-new-dir-input",
                className: "neo-gallery-dir-input",
                placeholder: "Enter directory path...",
                title: "Paste or type a full directory path here"
            }),
            $el("button", {
                className: "neo-gallery-dir-add-btn",
                onclick: async () => {
                    const input = document.getElementById('neo-gallery-new-dir-input');
                    const dirPath = input.value.trim();

                    if (!dirPath) return;

                    try {
                        const resp = await api.fetchApi('/neo_gallery/save_settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: "add", path: dirPath })
                        });
                        const result = await resp.json();

                        if (resp.ok && result.success) {
                            input.value = '';
                            setTimeout(() => gallery.promptAndSetCustomDir(), 300);
                            try { await gallery.loadGallery(); gallery.sortAndDisplayImages(); } catch (e) { }
                        } else {
                            alert('Failed: ' + (result.error || 'Unknown error'));
                        }
                    } catch (e) {
                        console.error('[Neo Gallery] Error adding directory:', e);
                        alert('Error adding directory');
                    }
                },
                textContent: "\u27A4"
            })
        ]);

        // Quick add buttons
        const quickAddArea = $el("div", { className: "neo-gallery-dir-quick-add" }, [
            $el("span", { className: "neo-gallery-dir-quick-label", textContent: "Quick add:" }),
            $el("button", {
                className: "neo-gallery-dir-quick-btn neo-gallery-dir-quick-input",
                onclick: async () => {
                    try {
                        const resp = await api.fetchApi('/neo_gallery/resolve_path?path_type=input');
                        if (resp.ok) {
                            const result = await resp.json();
                            if (result.success && result.path) {
                                const saveResp = await api.fetchApi('/neo_gallery/save_settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: "add", path: result.path })
                                });
                                const saveResult = await saveResp.json();

                                if (saveResp.ok && saveResult.success) {
                                    setTimeout(() => gallery.promptAndSetCustomDir(), 300);
                                    try { await gallery.loadGallery(); gallery.sortAndDisplayImages(); } catch (e) { }
                                } else {
                                    alert('Failed: ' + (result.error || 'Unknown error'));
                                }
                            } else {
                                alert(result.error || 'Could not resolve input directory');
                            }
                        } else {
                            alert('Failed to get ComfyUI input path');
                        }
                    } catch (e) {
                        console.error('[Gallery] Error resolving input path:', e);
                        alert('Error getting ComfyUI input path');
                    }
                },
                textContent: "\uD83D\uDCE5 Input"
            }),
            $el("button", {
                className: "neo-gallery-dir-quick-btn neo-gallery-dir-quick-output",
                onclick: async () => {
                    try {
                        const resp = await api.fetchApi('/neo_gallery/resolve_path?path_type=output');
                        if (resp.ok) {
                            const result = await resp.json();
                            if (result.success && result.path) {
                                const saveResp = await api.fetchApi('/neo_gallery/save_settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: "add", path: result.path })
                                });
                                const saveResult = await saveResp.json();

                                if (saveResp.ok && saveResult.success) {
                                    setTimeout(() => gallery.promptAndSetCustomDir(), 300);
                                    try { await gallery.loadGallery(); gallery.sortAndDisplayImages(); } catch (e) { }
                                } else {
                                    alert('Failed: ' + (saveResult.error || 'Unknown error'));
                                }
                            } else {
                                alert(result.error || 'Could not resolve output directory');
                            }
                        } else {
                            alert('Failed to get ComfyUI output path');
                        }
                    } catch (e) {
                        console.error('[Gallery] Error resolving output path:', e);
                        alert('Error getting ComfyUI output path');
                    }
                },
                textContent: "\uD83D\uDCE4 Output"
            })
        ]);

        // Bulk add area
        const bulkArea = $el("div", { className: "neo-gallery-dir-bulk-area" }, [
            $el("textarea", {
                id: "neo-gallery-bulk-dir-input",
                className: "neo-gallery-dir-textarea",
                placeholder: "Bulk add (one path per line):\n/path/to/dir1\n/path/to/dir2",
                rows: 3
            }),
            $el("button", {
                className: "neo-gallery-dir-bulk-btn",
                onclick: async () => {
                    const textarea = document.getElementById('neo-gallery-bulk-dir-input');
                    const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                    if (lines.length === 0) return;

                    let successCount = 0;
                    for (const dirPath of lines) {
                        try {
                            const resp = await api.fetchApi('/neo_gallery/save_settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: "add", path: dirPath })
                            });
                            const result = await resp.json();
                            if (resp.ok && result.success) successCount++;
                        } catch (e) { }
                    }

                    if (successCount > 0) {
                        textarea.value = '';
                        setTimeout(() => gallery.promptAndSetCustomDir(), 300);
                        try { await gallery.loadGallery(); gallery.sortAndDisplayImages(); } catch (e) { }
                    } else if (lines.length > 0) {
                        alert('All directories failed to add. Check paths and try again.');
                    }
                },
                textContent: "Add All"
            })
        ]);

        modal.appendChild(titleBar);
        modal.appendChild(dirListContainer);
        modal.appendChild(addArea);
        modal.appendChild(quickAddArea);
        modal.appendChild(bulkArea);
        modalOverlay.appendChild(modal);
        document.body.appendChild(modalOverlay);

        setTimeout(() => {
            const input = document.getElementById('neo-gallery-new-dir-input');
            if (input) input.focus();
        }, 100);
    }

    // ====== Send Menus ======

    _removeSendMenu() {
        const existing = document.getElementById('neo-gallery-send-menu');
        if (existing) existing.remove();
    }

    _removeImgSendMenu() {
        const existing = document.getElementById('neo-gallery-img-send-menu');
        if (existing) existing.remove();
    }

    async _showVideoSendMenu(gallery, image, button) {
        this._removeVideoSendMenu();
        if (!isVideoFile(image.filename)) {
            showToast(gallery.app, 'warning', 'Not a Video', 'This file is not a video.');
            return;
        }
        const menuItems = [];
        gallery.app.graph._nodes.forEach(node => {
            if (!node.widgets) return;
            node.widgets.forEach((widget, index) => {
                const wn = (widget.name || '').toLowerCase();
                const isLoadVideo = /load.?video/i.test(node.comfyClass || '') || /load.?video/i.test(node.title || '');
                const isVideoWidget = /video/.test(wn);
                if (isLoadVideo && widget.type === 'combo' && /video/.test(wn)) {
                    menuItems.push({ nodeId: node.id, widgetIndex: index, label: `\u25B8 ${node.title || 'Node'} \u2192 ${widget.name}`, isLoadVideo, isText: false });
                } else if ((isLoadVideo || isVideoWidget) && widget.inputEl) {
                    menuItems.push({ nodeId: node.id, widgetIndex: index, label: `\u25B8 ${node.title || 'Node'} \u2192 ${widget.name}`, isLoadVideo, isText: widget.type === 'customtext' || widget.type === 'text' });
                }
            });
        });

        const selKeys = Object.keys(gallery.app.canvas.selected_nodes);
        let selectedNodeId = null;
        if (selKeys.length > 0) {
            const sn = gallery.app.canvas.selected_nodes[selKeys[0]];
            const isLoadVideo = /load.?video/i.test(sn.comfyClass || '') || /load.?video/i.test(sn.title || '');
            const hasVideoWidget = sn.widgets && sn.widgets.some(w => /video/.test((w.name || '').toLowerCase()));
            if (isLoadVideo && hasVideoWidget) {
                selectedNodeId = sn.id;
            }
        }
        if (menuItems.length === 0 && !selectedNodeId) {
            showToast(gallery.app, 'warning', 'No Target', 'No LoadVideo-type nodes found.');
            return;
        }

        menuItems.forEach(item => {
            item.isSelected = item.nodeId === selectedNodeId;
        });
        menuItems.sort((a, b) => {
            if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
            if (a.isLoadImage !== b.isLoadImage) return a.isLoadImage ? -1 : 1;
            return 0;
        });

        if (menuItems.length === 1 && !selectedNodeId) {
            const item = menuItems[0];
            gallery.sendVideoToNode(image, `${item.nodeId}:widget:${item.widgetIndex}`, button);
            return;
        }

        const dropdown = $el("div", { id: "neo-gallery-video-send-menu", className: "neo-gallery-send-menu" });
        for (const item of menuItems) {
            const label = item.isSelected ? `${item.label} \u2713` : item.label;
            const el = $el("div", {
                className: "neo-gallery-send-menu-item" + (item.isSelected ? " neo-gallery-send-menu-selected" : ""),
                onclick: (e) => { e.stopPropagation(); this._removeVideoSendMenu(); gallery.sendVideoToNode(image, `${item.nodeId}:widget:${item.widgetIndex}`, button); },
                textContent: label
            });
            dropdown.appendChild(el);
        }
        const rect = button.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
        dropdown.style.zIndex = '10001';
        document.body.appendChild(dropdown);
        requestAnimationFrame(() => {
            dropdown.style.top = (rect.top - dropdown.offsetHeight - 8) + 'px';
        });
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== button) {
                this._removeVideoSendMenu();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    _removeVideoSendMenu() {
        const existing = document.getElementById('neo-gallery-video-send-menu');
        if (existing) existing.remove();
    }

    async _showImgSendMenu(gallery, image, button) {
        gallery._removeImgSendMenu();
        if (!/\.(png|jpg|jpeg|gif|webp|bmp|tiff|mp4|webm|mov|avi)$/i.test(image.filename)) {
            showToast(gallery.app, 'warning', 'Not an Image', 'This file is not an image.');
            return;
        }
        const menuItems = [];
        gallery.app.graph._nodes.forEach(node => {
            if (!node.widgets) return;
            node.widgets.forEach((widget, index) => {
                const wn = (widget.name || '').toLowerCase();
                const isLoadImage = /load.?image/i.test(node.comfyClass || '') || /load.?image/i.test(node.title || '');
                const isImageWidget = /image|upload/.test(wn);
                if (isLoadImage && widget.type === 'combo' && /image/.test(wn)) {
                    menuItems.push({ nodeId: node.id, widgetIndex: index, label: `\u25B8 ${node.title || 'Node'} \u2192 ${widget.name}`, isLoadImage, isText: false });
                } else if ((isLoadImage || isImageWidget) && widget.inputEl) {
                    menuItems.push({ nodeId: node.id, widgetIndex: index, label: `\u25B8 ${node.title || 'Node'} \u2192 ${widget.name}`, isLoadImage, isText: widget.type === 'customtext' || widget.type === 'text' });
                }
            });
        });

        const selKeys = Object.keys(gallery.app.canvas.selected_nodes);
        let selectedNodeId = null;
        if (selKeys.length > 0) {
            const sn = gallery.app.canvas.selected_nodes[selKeys[0]];
            const isLoadImage = /load.?image/i.test(sn.comfyClass || '') || /load.?image/i.test(sn.title || '');
            const hasImageWidget = sn.widgets && sn.widgets.some(w => /image|upload/.test((w.name || '').toLowerCase()));
            const hasTextWidget = sn.widgets && sn.widgets.some(w => ['string', 'text', 'customtext'].includes(w.type));
            if ((isLoadImage && hasImageWidget) || hasTextWidget) {
                selectedNodeId = sn.id;
            }
        }
        if (menuItems.length === 0 && !selectedNodeId) {
            showToast(gallery.app, 'warning', 'No Target', 'No LoadImage-type nodes found.');
            return;
        }

        menuItems.forEach(item => {
            item.isSelected = item.nodeId === selectedNodeId;
        });
        menuItems.sort((a, b) => {
            if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
            if (a.isLoadImage !== b.isLoadImage) return a.isLoadImage ? -1 : 1;
            return 0;
        });

        if (menuItems.length === 1 && !selectedNodeId) {
            const item = menuItems[0];
            gallery.sendImageToNode(image, `${item.nodeId}:widget:${item.widgetIndex}`, button);
            return;
        }

        const dropdown = $el("div", { id: "neo-gallery-img-send-menu", className: "neo-gallery-send-menu" });
        for (const item of menuItems) {
            const label = item.isSelected ? `${item.label} \u2713` : item.label;
            const el = $el("div", {
                className: "neo-gallery-send-menu-item" + (item.isSelected ? " neo-gallery-send-menu-selected" : ""),
                onclick: (e) => { e.stopPropagation(); gallery._removeImgSendMenu(); gallery.sendImageToNode(image, `${item.nodeId}:widget:${item.widgetIndex}`, button); },
                textContent: label
            });
            dropdown.appendChild(el);
        }
        const rect = button.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
        dropdown.style.zIndex = '10001';
        document.body.appendChild(dropdown);
        requestAnimationFrame(() => {
            dropdown.style.top = (rect.top - dropdown.offsetHeight - 8) + 'px';
        });
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== button) {
                gallery._removeImgSendMenu();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    async _showSendMenu(gallery, image, button) {
        gallery._removeSendMenu();
        const menuItems = [];

        gallery.app.graph._nodes.forEach(node => {
            if (!node.widgets) return;
            node.widgets.forEach((widget, index) => {
                const wn = (widget.name || '').toLowerCase();
                if (/negative/.test(wn)) return;
                if (widget.inputEl && /string|text|custom/.test(widget.type || '')) {
                    menuItems.push({ nodeId: node.id, widgetIndex: index, label: `\u25B8 ${node.title || 'Node'} \u2192 ${widget.name}`, isNeoPrompt: /neo.?prompt/i.test(node.title) });
                }
            });
        });

        const selKeys = Object.keys(gallery.app.canvas.selected_nodes);
        let selectedNodeId = null;
        if (selKeys.length > 0) {
            const sn = gallery.app.canvas.selected_nodes[selKeys[0]];
            if (sn && sn.widgets && sn.widgets.some(w => !/negative/.test((w.name || '').toLowerCase()) && w.inputEl && /string|text|custom/.test(w.type || ''))) {
                selectedNodeId = sn.id;
            }
        }

        if (menuItems.length === 0 && !selectedNodeId) {
            showToast(gallery.app, 'warning', 'No Target', 'No valid text nodes found.');
            return;
        }

        menuItems.forEach(item => { item.isSelected = item.nodeId === selectedNodeId; });
        menuItems.sort((a, b) => {
            if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
            if (a.isNeoPrompt !== b.isNeoPrompt) return a.isNeoPrompt ? -1 : 1;
            return 0;
        });

        const hasSelection = selKeys.length > 0;
        console.log(`[Neo Gallery] _showSendMenu: selectedNodes=${selKeys.length}, menuItems=${menuItems.length}, autoSelect=${!hasSelection && menuItems.length === 1}`);
        if (!hasSelection && menuItems.length === 1) {
            this.sendToTarget(image.name, image.txt_content, button, menuItems[0].nodeId, menuItems[0].widgetIndex);
            return;
        }

        const dropdown = $el("div", { id: "neo-gallery-send-menu", className: "neo-gallery-send-menu" });
        for (const item of menuItems) {
            const label = item.isSelected ? `${item.label} \u2713` : item.label;
            const el = $el("div", {
                className: "neo-gallery-send-menu-item" + (item.isSelected ? " neo-gallery-send-menu-selected" : ""),
                onclick: (e) => {
                    e.stopPropagation();
                    gallery._removeSendMenu();
                    this.sendToTarget(image.name, image.txt_content, button, item.nodeId, item.widgetIndex);
                },
                textContent: label
            });
            dropdown.appendChild(el);
        }
        const rect = button.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
        dropdown.style.zIndex = '10001';
        document.body.appendChild(dropdown);
        requestAnimationFrame(() => {
            dropdown.style.top = (rect.top - dropdown.offsetHeight - 8) + 'px';
        });
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== button) {
                gallery._removeSendMenu();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    // ====== Internal Helpers ======

    /**
     * Resolve target node and widget from a nodeId (used by copyToClipboard).
     */
    _resolveTargetFromNodeId(nodeId) {
        const targetNode = this.gallery.app.graph.getNodeById(parseInt(nodeId));
        if (!targetNode) return null;

        let isPromptNode = !!targetNode._rsPromptUIElements;
        let targetWidget = null;

        if (isPromptNode) {
            return { targetNode, isPromptNode: true, targetWidget: null };
        }

        // Find first valid text widget as fallback
        targetWidget = targetNode.widgets?.find(w => ['string', 'text', 'customtext'].includes(w.type));
        return { targetNode, isPromptNode: false, targetWidget };
    }

    /**
     * Send cleaned text to a resolved target (prompt node or regular widget).
     */
    _sendToResolvedTarget(textToCopy, targetNode, isPromptNode, targetWidget, feedbackBtn) {
        if (!targetNode) return;

        // Branch 1: Neo Prompt node with custom textarea
        if (isPromptNode && targetNode._rsPromptUIElements) {
            const { customTextarea, textWidget } = targetNode._rsPromptUIElements;
            if (customTextarea) {
                customTextarea.value = textToCopy;
                customTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
            if (textWidget) {
                textWidget.value = textToCopy;
            }
            this.gallery.app.graph.setDirtyCanvas(true, true);
            if (feedbackBtn) showInlineFeedback(feedbackBtn, '\u2705 Sent!', 'success');
            else showToast(this.gallery.app, 'success', 'Tags Sent!', `Sent to ${targetNode.title || 'Node'}`);
        }
        // Branch 2: Regular widget on target node
        else if (targetWidget) {
            targetWidget.value = textToCopy;
            try {
                if (targetNode.onWidgetChanged) {
                    targetNode.onWidgetChanged(targetWidget.name, targetWidget.value);
                }
            } catch (e) {
                console.warn(`[Neo Gallery] onWidgetChanged threw: ${e.message}`);
            }
            this.gallery.app.graph.setDirtyCanvas(true, true);
            if (feedbackBtn) showInlineFeedback(feedbackBtn, '\u2705 Sent!', 'success');
            else showToast(this.gallery.app, 'success', 'Tags Sent!', `Sent to ${targetNode.title} - ${targetWidget.name}`);
        }
    }

    // ====== Public API ======

    /**
     * Send text to a specific node/widget by explicit nodeId and widgetIndex.
     * Falls back to clipboard copy if target resolution fails.
     */
    sendToTarget(imageName, txtContent, feedbackBtn = null, targetNodeId, targetWidgetIndex) {
        const textToCopy = this._cleanText(txtContent);

        // Resolve target node by explicit nodeId
        const resolved = this._resolveTargetFromNodeId(targetNodeId);
        if (!resolved || !resolved.targetNode) {
            console.error(`[Neo Gallery] sendToTarget: Failed to get node by id ${targetNodeId}, falling back to clipboard`);
            return this._fallbackToClipboard(textToCopy, feedbackBtn);
        }

        // For regular widgets, use the specific widget index
        let targetWidget = resolved.targetWidget;
        if (!resolved.isPromptNode && targetWidgetIndex != null) {
            targetWidget = resolved.targetNode.widgets?.[parseInt(targetWidgetIndex)];
            if (!targetWidget) {
                console.error(`[Neo Gallery] sendToTarget: targetWidget[${targetWidgetIndex}] is null/undefined, falling back to clipboard`);
                return this._fallbackToClipboard(textToCopy, feedbackBtn);
            }
        }

        this._sendToResolvedTarget(textToCopy, resolved.targetNode, resolved.isPromptNode, targetWidget, feedbackBtn);
    }

    /**
     * Copy text to system clipboard only.
     */
    copyToClipboard(imageName, txtContent, feedbackBtn = null) {
        const textToCopy = this._cleanText(txtContent);
        return this._fallbackToClipboard(textToCopy, feedbackBtn);
    }

    /**
     * Clean text content for copying.
     */
    _cleanText(txtContent) {
        return String(txtContent || "").trim();
    }

    /**
     * Fallback: write to system clipboard.
     */
    _fallbackToClipboard(textToCopy, feedbackBtn = null) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            if (feedbackBtn) showInlineFeedback(feedbackBtn, '\u2705 Copied!', 'success');
            else showToast(this.gallery.app, 'success', 'Tags Copied!', `Copied to clipboard`);
        }).catch((err) => {
            console.error('[Neo Gallery] Clipboard write failed:', err);
            if (feedbackBtn) showInlineFeedback(feedbackBtn, '\u274C Failed', 'error');
        });
    }

    // ====== Card Creation ======

    async createDirCard(gallery, name, path, items, subdirs = {}, readOnly = false) {
        const card = $el("div", {
            className: "neo-gallery-category-card",
            onclick: () => gallery.showDirectoryStructure(name, [])
        });

        const coverWrapper = $el("div", {
            className: "neo-gallery-card-cover-wrapper",
            style: { minHeight: `${Math.max(gallery.maxThumbnailSize * 0.5, 80)}px`, maxHeight: `${gallery.maxThumbnailSize}px` }
        });

        coverWrapper.appendChild($el("div", {
            className: "neo-gallery-card-cover neo-gallery-card-placeholder",
            textContent: "\uD83D\uDCC1"
        }));

        const info = $el("div", { className: "neo-gallery-card-info" }, [
            $el("span", { className: "neo-gallery-card-name", textContent: name }),
            $el("span", { className: "neo-gallery-card-count", textContent: `${(items || []).length} items` })
        ]);

        const typeBadge = $el("div", {
            className: "neo-gallery-card-type-badge type-directory",
            title: "Directory"
        }, ["\uD83D\uDCC1"]);

        if (!readOnly) {
            const deleteBtn = $el("div", {
                className: "neo-gallery-card-delete-btn",
                title: `Remove directory "${name}"`,
                onclick: (e) => {
                    e.stopPropagation();
                    gallery.removeCustomDir(path);
                }
            }, ["\u00D7"]);
            card.appendChild(deleteBtn);
        }

        card.appendChild(typeBadge);
        card.appendChild(coverWrapper);
        card.appendChild(info);

        // Fetch sample images from subdirectories asynchronously (skips empty intermediate dirs)
        setTimeout(async () => {
            try {
                const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(name)}&path=&samples=2`);
                if (!resp.ok) throw new Error('Failed to fetch');

                const structure = await resp.json();
                const countEl = card.querySelector('.neo-gallery-card-count');

                if (countEl) {
                    countEl.textContent = `${structure.total_images} items`;
                }

                let finalCoverImages = [];

                if (structure.sample_images && structure.sample_images.length > 0) {
                    finalCoverImages = structure.sample_images.slice(0, 2);
                } else if (structure.images && structure.images.length > 0) {
                    finalCoverImages = structure.images.slice(0, 2);
                }

                if (finalCoverImages.length > 0) {
                    coverWrapper.innerHTML = '';
                    const coverGrid = $el("div", { className: "neo-gallery-card-cover-grid" });

                    let loadedCount = 0;
                    const displayImages = finalCoverImages.slice(0, 2);

                    displayImages.forEach((imgData) => {
                        const imgSubfolder = imgData.subfolder || "";
                        const imgItem = $el("div", { className: "neo-gallery-card-cover-grid-item" });

                        const img = $el("img", {
                            src: getThumbnailSrc(imgData, imgSubfolder),
                            alt: name,
                            loading: "lazy"
                        });

                        img.onload = () => {
                            loadedCount++;
                            if (loadedCount === displayImages.length) {
                                const height = getCoverHeight(coverWrapper, gallery);
                                coverGrid.style.height = `${height * 2}px`;
                            }
                        };

                        img.onerror = () => {
                            imgItem.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:24px;">\uD83D\uDCCB</div>';
                        };

                        imgItem.appendChild(img);
                        coverGrid.appendChild(imgItem);
                    });

                    coverWrapper.appendChild(coverGrid);
                } else {
                    coverWrapper.innerHTML = '';
                    coverWrapper.appendChild($el("div", {
                        className: "neo-gallery-card-cover neo-gallery-card-placeholder",
                        textContent: "\uD83D\uDCCB"
                    }));
                }
            } catch (e) {
                console.error('[Gallery] Error fetching dir sample images:', e);
            }
        }, 0);

        return card;
    }

    async createSubdirCard(gallery, subdirName, parentDir, fullPath) {
        const cardHeight = getCardHeight(gallery);

        const card = $el("div", {
            className: "neo-gallery-category-card",
            onclick: () => gallery.showDirectoryStructure(parentDir, fullPath),
            style: { width: `${gallery.maxThumbnailSize}px`, minHeight: `${cardHeight}px` }
        });

        const typeBadge = $el("div", {
            className: "neo-gallery-card-type-badge neo-gallery-card-type-loading",
            title: "Loading..."
        }, ["\uD83D\uDCC1"]);

        const coverWrapper = $el("div", {
            className: "neo-gallery-card-cover-wrapper",
            style: { minHeight: `${Math.max(gallery.maxThumbnailSize * 0.5, 80)}px`, maxHeight: `${gallery.maxThumbnailSize}px` }
        });

        coverWrapper.appendChild($el("div", {
            className: "neo-gallery-card-cover neo-gallery-card-placeholder",
            textContent: "\uD83D\uDCC1"
        }));

        const info = $el("div", { className: "neo-gallery-card-info" }, [
            $el("span", { className: "neo-gallery-card-name", textContent: subdirName }),
            $el("span", { className: "neo-gallery-card-count", textContent: "Loading..." })
        ]);

        card.appendChild(typeBadge);
        card.appendChild(coverWrapper);
        card.appendChild(info);

        // Fetch directory structure asynchronously with sample images for cover thumbnails
        setTimeout(async () => {
            try {
                const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(parentDir)}&path=${encodeURIComponent(fullPath.join("/"))}&samples=2`);
                if (!resp.ok) throw new Error('Failed to fetch');

                const structure = await resp.json();
                const countEl = card.querySelector('.neo-gallery-card-count');
                const typeBadge = card.querySelector('.neo-gallery-card-type-badge');

                if (countEl) {
                    countEl.textContent = `${structure.total_images} items`;
                }

                if (typeBadge) {
                    typeBadge.className = 'neo-gallery-card-type-badge neo-gallery-card-type-loading type-directory';
                    typeBadge.title = 'Directory';
                    typeBadge.textContent = '\uD83D\uDCC1';
                }

                let coverImages = [];

                // First priority: use sample_images from backend (recursively collected)
                if (structure.sample_images && structure.sample_images.length > 0) {
                    coverImages = structure.sample_images.slice(0, 2);
                } else if (structure.images && structure.images.length > 0) {
                    // Fallback: use direct images at this level
                    let currentSubfolder;
                    if (fullPath.length > 0) {
                        currentSubfolder = parentDir + "/" + fullPath.join("/");
                    } else {
                        currentSubfolder = parentDir;
                    }
                    coverImages = structure.images.slice(0, 2);
                } else if (structure.subdirs && structure.subdirs.length > 0) {
                    // Last resort: no sample_images from backend, try to fetch manually
                    let currentSubfolder;
                    if (fullPath.length > 0) {
                        currentSubfolder = parentDir + "/" + fullPath.join("/");
                    } else {
                        currentSubfolder = parentDir;
                    }

                    // Collect images from the first few subdirectories
                    const maxFetch = Math.min(3, structure.subdirs.length);

                    for (let i = 0; i < maxFetch && coverImages.length < 2; i++) {
                        try {
                            const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(parentDir)}&path=${encodeURIComponent(fullPath.join("/"))}/${encodeURIComponent(structure.subdirs[i])}&samples=2`);
                            if (resp.ok) {
                                const subStructure = await resp.json();
                                if (subStructure.sample_images && subStructure.sample_images.length > 0) {
                                    coverImages.push(subStructure.sample_images[0]);
                                } else if (subStructure.images && subStructure.images.length > 0) {
                                    coverImages.push(subStructure.images[0]);
                                } else if (subStructure.subdirs && subStructure.subdirs.length > 0) {
                                    const deepResp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(parentDir)}&path=${encodeURIComponent(fullPath.join("/"))}/${encodeURIComponent(subStructure.subdirs[0])}&samples=2`);
                                    if (deepResp.ok) {
                                        const deepStructure = await deepResp.json();
                                        if (deepStructure.sample_images && deepStructure.sample_images.length > 0) {
                                            coverImages.push(deepStructure.sample_images[0]);
                                        } else if (deepStructure.images && deepStructure.images.length > 0) {
                                            coverImages.push(deepStructure.images[0]);
                                        }
                                    }
                                }
                            }
                        } catch (e) { }
                    }
                }

                if (coverImages.length > 0) {
                    coverWrapper.innerHTML = '';

                    const coverGrid = $el("div", { className: "neo-gallery-card-cover-grid" });

                    let loadedCount = 0;
                    const displayImages = coverImages.slice(0, 2);

                    displayImages.forEach((imgData) => {
                        // Use the subfolder from the image data itself (set by backend)
                        const imgSubfolder = imgData.subfolder || "";

                        const imgItem = $el("div", { className: "neo-gallery-card-cover-grid-item" });

                        const img = $el("img", {
                            src: getThumbnailSrc(imgData, imgSubfolder),
                            alt: subdirName,
                            loading: "lazy"
                        });

                        img.onload = () => {
                            loadedCount++;
                            if (loadedCount === displayImages.length) {
                                const height = getCoverHeight(coverWrapper, gallery);
                                coverGrid.style.height = `${height * 2}px`;
                            }
                        };

                        img.onerror = () => {
                            imgItem.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:24px;">\uD83D\uDCCB</div>';
                        };

                        imgItem.appendChild(img);
                        coverGrid.appendChild(imgItem);
                    });

                    coverWrapper.appendChild(coverGrid);
                } else {
                    // No images found at any level, show folder icon
                    coverWrapper.innerHTML = '';
                    coverWrapper.appendChild($el("div", {
                        className: "neo-gallery-card-cover neo-gallery-card-placeholder",
                        textContent: "\uD83D\uDCCB"
                    }));
                }
            } catch (e) {
                console.error('[Gallery] Error fetching subdir info:', e);
            }
        }, 0);

        return card;
    }

    // ====== Image Element ======

    createImageElement(gallery, image, subfolder, readOnly = false) {
        const isImageFileResult = isImageFile(image.filename);
        const isVideoFileResult = isVideoFile(image.filename);
        const reservedSpace = getReservedSpace(gallery.displayLabels);
        const imageHeight = getImageHeight(gallery.maxThumbnailSize, gallery.displayLabels);

        const container = $el("div", {
            className: "neo-gallery-thumb-container",
            style: {
                height: `${gallery.maxThumbnailSize}px`,
                width: `${gallery.maxThumbnailSize}px`
            },
            onclick: () => gallery.showLightbox(image, subfolder),
            dataset: { filename: image.filename, subfolder: subfolder }
        });

        let deleteBtn = null;
        const isPresets = subfolder.toLowerCase() === 'presets' || subfolder.toLowerCase().startsWith('presets/');
        if (!isPresets && !readOnly) {
            deleteBtn = $el("div", {
                className: "neo-gallery-delete-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    gallery.deleteItem(image.name, subfolder);
                }
            }, ["\u00D7"]);
        }

        let imgSendBtn = null;
        if (!isVideoFileResult) {
            imgSendBtn = $el("div", {
                className: "neo-gallery-thumb-img-send-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    gallery._showImgSendMenu(image, imgSendBtn);
                }
            }, ["\uD83D\uDCE4"]);
        }

        let sendBtn = null;
        if (image.txt_content) {
            sendBtn = $el("div", {
                className: "neo-gallery-thumb-send-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    gallery._showSendMenu(image, sendBtn);
                }
            }, ["\u2708\uFE0F"]);
        }

        let videoSendBtn = null;
        if (isVideoFileResult) {
            videoSendBtn = $el("div", {
                className: "neo-gallery-thumb-video-send-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    gallery._showVideoSendMenu(image, videoSendBtn);
                }
            }, ["\uD83D\uDCE5"]);
        }

        let copyBtn = null;
        if (image.txt_content) {
            copyBtn = $el("div", {
                className: "neo-gallery-thumb-copy-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    this.copyToClipboard(image.name, image.txt_content, copyBtn);
                }
            }, ["\u29C9"]);
        }

        let mediaEl;
        if (isVideoFileResult) {
            // Video thumbnail
            const videoSrc = getThumbnailSrc(image, subfolder);
            mediaEl = $el("img", {
                className: "neo-gallery-thumb-img",
                src: videoSrc,
                alt: image.name,
                onerror: () => {
                    mediaEl.src = gallery.placeholderImageUrl;
                }
            });
        } else if (isImageFileResult) {
            // Image thumbnail
            const src = getThumbnailSrc(image, subfolder);
            const img = new Image();
            img.onload = () => {
                const aspectRatio = img.height / img.width;
                container.style.width = `${Math.max(gallery.maxThumbnailSize * (1 / aspectRatio), 40)}px`;
            };
            img.src = src;
            mediaEl = $el("img", {
                className: "neo-gallery-thumb-img",
                src: src,
                alt: image.name,
                onerror: () => {
                    mediaEl.src = gallery.placeholderImageUrl;
                }
            });
        } else {
            // Unknown type - show placeholder
            mediaEl = $el("div", {
                className: "neo-gallery-thumb-img neo-gallery-thumb-placeholder",
                textContent: "\uD83D\uDCCB"
            });
        }

        const btnBar = $el("div", { className: "neo-gallery-thumb-btn-bar" }, [videoSendBtn, sendBtn, imgSendBtn, copyBtn].filter(Boolean));

        const imgWrapper = $el("div", { className: "neo-gallery-thumb-img-wrapper" }, [mediaEl, btnBar]);

        const labelEl = gallery.displayLabels ? $el("span", {
            className: "neo-gallery-image-label",
            textContent: image.name.replace(/\.\w+$/, '')
        }) : null;

        if (deleteBtn) container.appendChild(deleteBtn);
        container.appendChild(imgWrapper);
        if (labelEl) container.appendChild(labelEl);

        container.title = image.name.replace(/\.\w+$/, '');

        return container;
    }

    // ====== Breadcrumb Navigation ======

    createBreadcrumbHome(gallery) {
        return createBreadcrumbItem("\uD83C\uDFE0", () => gallery.showCategoryCards(), { isHome: true });
    }

    updateBreadcrumb(gallery, pathSegments, sourceName) {
        const breadcrumb = document.getElementById("neo-gallery-breadcrumb");
        if (!breadcrumb) return;

        gallery._removeSiblingDropdown();

        const rootDirName = gallery.currentView.source || '';

        if (pathSegments.length === 0 && !sourceName && !rootDirName) {
            breadcrumb.style.display = 'flex';
            breadcrumb.innerHTML = '';
            breadcrumb.appendChild(gallery.createBreadcrumbHome());
            return;
        }

        breadcrumb.style.display = 'flex';
        breadcrumb.innerHTML = '';

        breadcrumb.appendChild(gallery.createBreadcrumbHome());

        if (rootDirName) {
            breadcrumb.appendChild(createBreadcrumbSeparator());

            if (pathSegments.length > 0) {
                breadcrumb.appendChild(createBreadcrumbItem(rootDirName, () => gallery.showDirectoryStructure(rootDirName, [])));
            } else {
                breadcrumb.appendChild(createBreadcrumbItem(rootDirName, null, { isCurrent: true }));
            }

            for (let i = 0; i < pathSegments.length; i++) {
                breadcrumb.appendChild(createBreadcrumbSeparator());

                if (i === pathSegments.length - 1) {
                    const currentSegmentEl = createBreadcrumbItem(pathSegments[i], null, { isCurrent: true, title: "点击显示同级目录" });
                    currentSegmentEl.classList.add('neo-gallery-breadcrumb-sibling-trigger');
                    currentSegmentEl.onclick = (e) => {
                        e.stopPropagation();
                        gallery._toggleSiblingDropdown(e, rootDirName, pathSegments);
                    };
                    breadcrumb.appendChild(currentSegmentEl);
                } else {
                    breadcrumb.appendChild(createBreadcrumbItem(pathSegments[i], () => gallery.showDirectoryStructure(rootDirName, pathSegments.slice(0, i + 1))));
                }
            }

            if (pathSegments.length > 0) {
                breadcrumb.appendChild(createSpacer());
                breadcrumb.appendChild(createBreadcrumbItem("\u2B06", () => gallery.showDirectoryStructure(rootDirName, pathSegments.slice(0, -1)), { isUp: true, title: "上一级" }));
            } else {
                // Show back button for root directory of custom dir
                breadcrumb.appendChild(createSpacer());
                breadcrumb.appendChild(createBreadcrumbItem("\u2B06", () => gallery.showCategoryCards(), { isUp: true, title: "返回上级" }));
            }
        } else if (sourceName) {
            breadcrumb.appendChild(createBreadcrumbSeparator());
            breadcrumb.appendChild(createBreadcrumbItem(sourceName, null, { isCurrent: true }));

            if (pathSegments.length > 0 || sourceName) {
                breadcrumb.appendChild(createSpacer());
                breadcrumb.appendChild(createBreadcrumbItem("\u2B06", () => gallery.showCategoryCards(), { isUp: true, title: "返回上级" }));
            }
        }
    }

    // ====== Sibling Directory Dropdown ======

    _removeSiblingDropdown() {
        const existing = document.getElementById('neo-gallery-sibling-dropdown');
        if (existing) existing.remove();
    }

    async _toggleSiblingDropdown(gallery, event, rootDirName, pathSegments) {
        gallery._removeSiblingDropdown();

        const trigger = event.currentTarget;
        if (trigger.classList.contains('neo-gallery-breadcrumb-sibling-trigger')) {
            const existingDropdown = document.getElementById('neo-gallery-sibling-dropdown');
            if (existingDropdown) {
                existingDropdown.remove();
                return;
            }
        }

        const parentPath = pathSegments.slice(0, -1);

        let siblings = [];
        try {
            const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(rootDirName)}&path=${encodeURIComponent(parentPath.join("/"))}`);
            if (resp.ok) {
                const structure = await resp.json();
                siblings = (structure.subdirs || []).map(s => ({ name: s, path: [...parentPath, s] }));
            }
        } catch (e) {
            console.error('[Gallery] Error fetching sibling directories:', e);
        }

        if (siblings.length === 0) return;

        const dropdown = $el("div", {
            id: "neo-gallery-sibling-dropdown",
            className: "neo-gallery-sibling-dropdown"
        });

        const rect = event.target.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
        dropdown.style.zIndex = '9999';

        const listContainer = $el("div", { className: "neo-gallery-sibling-list" });

        for (const sib of siblings) {
            const item = $el("div", {
                className: "neo-gallery-sibling-item",
                onclick: (e) => {
                    e.stopPropagation();
                    gallery._removeSiblingDropdown();
                    gallery.showDirectoryStructure(rootDirName, sib.path);
                },
                textContent: sib.name
            });

            item.onmouseenter = () => item.classList.add('neo-gallery-sibling-item-hover');
            item.onmouseleave = () => item.classList.remove('neo-gallery-sibling-item-hover');

            listContainer.appendChild(item);
        }

        dropdown.appendChild(listContainer);
        document.body.appendChild(dropdown);

        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== trigger) {
                gallery._removeSiblingDropdown();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    // ====== Lightbox ======

    injectAnimations() { }

    showLightbox(gallery, image, subfolder) {
        gallery.injectAnimations();

        const existingLightbox = document.querySelector('.neo-gallery-lightbox');
        if (existingLightbox && gallery.currentLightboxImages && gallery.currentLightboxImages.length > 0) {
            const newIndex = gallery.currentLightboxImages.findIndex(img => img.filename === image.filename && img.subfolder === subfolder);
            if (newIndex >= 0) {
                gallery.updateLightboxContent(existingLightbox, image, subfolder, gallery.currentLightboxImages, newIndex);
                return;
            }
        }

        const existing = document.querySelector('.neo-gallery-lightbox');
        if (existing) existing.remove();

        // 使用原生 DOM API 创建 lightbox，确保 querySelector 能正常工作
        const lightbox = document.createElement('div');
        lightbox.id = "neo-gallery-lightbox";
        lightbox.className = "neo-gallery-lightbox";
        lightbox.onclick = (e) => {
            if (e.target === lightbox) {
                gallery.closeLightbox();
            }
        };

        const container = document.createElement('div');
        container.id = "neo-gallery-lightbox-container";
        container.className = "neo-gallery-lightbox-container";

        const imgWrapper = document.createElement('div');
        imgWrapper.id = "neo-gallery-lightbox-img-wrapper";
        imgWrapper.className = "neo-gallery-lightbox-img-wrapper";

        const categoryParam = image.category ? `&category=${encodeURIComponent(image.category)}` : '';
        const isVideo = isVideoFile(image.filename);
        const mediaUrl = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}${categoryParam}`;
        const videoUrl = `${window.location.protocol}//${window.location.host}/neo_gallery/video?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}`;

        let mediaEl;
        if (isVideo) {
            mediaEl = document.createElement('video');
            mediaEl.className = "neo-gallery-lightbox-image neo-gallery-lightbox-video";
            mediaEl.src = videoUrl;
            mediaEl.controls = true;
            mediaEl.autoplay = true;
            mediaEl.loop = true;
            mediaEl.style.maxWidth = '100%';
            mediaEl.style.maxHeight = '80vh';
        } else {
            mediaEl = document.createElement('img');
            mediaEl.className = "neo-gallery-lightbox-image";
            mediaEl.src = mediaUrl;
        }

        const closeBtn = document.createElement('div');
        closeBtn.className = "neo-gallery-lightbox-close-btn";
        closeBtn.textContent = "\u00D7";
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            gallery.closeLightbox();
        };

        let sendBtn = null;
        if (image.txt_content) {
            sendBtn = document.createElement('div');
            sendBtn.className = "neo-gallery-lightbox-btn neo-gallery-lightbox-send-btn";
            sendBtn.textContent = "\u2708\uFE0F Send";
            sendBtn.onclick = (e) => {
                e.stopPropagation();
                gallery._showSendMenu(image, sendBtn);
            };
        }

        let videoSendBtn = null;
        if (isVideo) {
            videoSendBtn = document.createElement('div');
            videoSendBtn.className = "neo-gallery-lightbox-btn neo-gallery-lightbox-video-send-btn";
            videoSendBtn.textContent = "\uD83D\uDCE5 Video";
            videoSendBtn.onclick = (e) => {
                e.stopPropagation();
                gallery._showVideoSendMenu(image, videoSendBtn);
            };
        }

        const copyBtn = document.createElement('div');
        copyBtn.className = "neo-gallery-lightbox-btn neo-gallery-lightbox-copy-btn";
        copyBtn.textContent = "\u29C9 Copy";
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            this.copyToClipboard(image.name, image.txt_content, copyBtn);
        };

        imgWrapper.appendChild(mediaEl);

        const imageInfo = document.createElement('div');
        if (!isVideo) {
            mediaEl.onload = () => {
                if (imageInfo) {
                    imageInfo.textContent = `${mediaEl.naturalWidth} \u00d7 ${mediaEl.naturalHeight}`;
                }
            };
        } else {
            mediaEl.onloadedmetadata = () => {
                if (imageInfo) {
                    imageInfo.textContent = `${mediaEl.videoWidth} \u00d7 ${mediaEl.videoHeight}`;
                }
            };
        }
        imgWrapper.appendChild(imageInfo);

        // Build all images list for navigation
        const allImages = [];
        const { source, categoryPath, mode } = gallery.currentView;

        // In lazy mode, dir.items may be empty - use saved _currentDirImages if available
        if (mode === 'categories') {
            for (const dir of gallery.allDirectories) {
                if (!gallery.isSearchActive || gallery.filteredDirectories.some(d => d.name === dir.name)) {
                    // Use saved images if dir.items is empty (lazy mode)
                    const items = (dir.items && dir.items.length > 0) ? dir.items : [];
                    for (const item of items) {
                        allImages.push({ ...item, subfolder: dir.name });
                    }
                }
            }
        } else if (source && mode !== 'categories') {
            const dir = gallery.allDirectories.find(d => d.name === source);
            if (dir) {
                // Directly use _currentDirImages when dir.items is undefined (lazy mode)
                let dirItems = [];
                if (dir.items && dir.items.length > 0) {
                    dirItems = [...dir.items];
                } else if (gallery._currentDirImages && gallery._currentDirImages.length > 0) {
                    dirItems = [...gallery._currentDirImages];
                }
                if (categoryPath && categoryPath.length > 0) {
                    const catKey = categoryPath[0];
                    dirItems = dirItems.filter(i => {
                        const match = i.category === catKey || !i.category;
                        return match;
                    });
                }
                for (const item of dirItems) {
                    allImages.push({ ...item, subfolder: item.subfolder || source });
                }
            }
        } else {
            for (const dir of gallery.allDirectories) {
                if (!gallery.isSearchActive || gallery.filteredDirectories.some(d => d.name === dir.name)) {
                    const items = (dir.items && dir.items.length > 0) ? dir.items : [];
                    for (const item of items) {
                        allImages.push({ ...item, subfolder: dir.name });
                    }
                }
            }
        }

        allImages.sort((a, b) => a.name.localeCompare(b.name));
        const currentIndex = allImages.findIndex(img => img.filename === image.filename && img.subfolder === subfolder);

        const prevBtn = $el("div", {
            id: "neo-gallery-lightbox-prev-btn",
            className: "neo-gallery-lightbox-nav-arrow",
            style: {
                cursor: currentIndex > 0 ? "pointer" : "not-allowed",
                opacity: currentIndex > 0 ? "0.8" : "0.3"
            },
            onclick: (e) => {
                if (currentIndex <= 0) return;
                e.stopPropagation();
                const prevItem = allImages[currentIndex - 1];
                gallery.updateLightboxContent(lightbox, prevItem, prevItem.subfolder, allImages, currentIndex - 1);
            }
        }, ["\u2039"]);
        imgWrapper.appendChild(prevBtn);

        const nextBtn = $el("div", {
            id: "neo-gallery-lightbox-next-btn",
            className: "neo-gallery-lightbox-nav-arrow",
            style: {
                cursor: currentIndex < allImages.length - 1 ? "pointer" : "not-allowed",
                opacity: currentIndex < allImages.length - 1 ? "0.8" : "0.3"
            },
            onclick: (e) => {
                if (currentIndex >= allImages.length - 1) return;
                e.stopPropagation();
                const nextItem = allImages[currentIndex + 1];
                gallery.updateLightboxContent(lightbox, nextItem, nextItem.subfolder, allImages, currentIndex + 1);
            }
        }, ["\u203A"]);
        imgWrapper.appendChild(nextBtn);

        let promptSection = null;
        if (image.txt_content) {
            promptSection = $el("div", {
                id: "neo-gallery-lightbox-prompt-section",
                className: "neo-gallery-lightbox-prompt-section"
            });

            const sections = this.gallery.parsePromptSections(image.txt_content);
            const promptContainer = $el("div", { className: "neo-gallery-lightbox-prompt-container" });

            if (sections.length > 0 && sections.some(s => s.label)) {
                for (const section of sections) {
                    if (section.label) {
                        const sectionEl = $el("div", { className: "neo-gallery-lightbox-prompt-section-item" }, [
                            $el("span", { className: "neo-gallery-lightbox-prompt-label", textContent: section.label + "\uff1a" }),
                            $el("span", { className: "neo-gallery-lightbox-prompt-value", textContent: section.value })
                        ]);
                        promptContainer.appendChild(sectionEl);
                    } else if (section.value) {
                        promptContainer.appendChild($el("div", {
                            textContent: section.value,
                            style: { marginBottom: "3px", whiteSpace: "pre-wrap" }
                        }));
                    }
                }
            } else {
                promptContainer.appendChild($el("div", {
                    textContent: gallery.cleanText(image.txt_content),
                    style: { whiteSpace: "pre-wrap" }
                }));
            }

            promptSection.appendChild(promptContainer);

            const promptBtnsContainer = $el("div", { className: "neo-gallery-lightbox-prompt-btns" });
            if (sendBtn) promptBtnsContainer.appendChild(sendBtn);
            if (videoSendBtn) promptBtnsContainer.appendChild(videoSendBtn);
            promptBtnsContainer.appendChild(copyBtn);
            promptSection.appendChild(promptBtnsContainer);
        } else {
            // 反推按钮：暂时隐藏（待修复图片消失问题后重新启用）
            const reverseBtn = $el("div", {
                id: "neo-gallery-lightbox-reverse-btn",
                className: "neo-gallery-lightbox-btn neo-gallery-lightbox-reverse-btn",
                style: { display: 'none' },
                onclick: async (e) => {
                    e.stopPropagation();
                    try {
                        reverseBtn.textContent = "\u231B 反推中...";
                        reverseBtn.style.pointerEvents = "none";
                        const resp = await api.fetchApi('/rs_prompts/reverse_prompt', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename: image.filename, subfolder: subfolder })
                        });
                        if (resp.ok) {
                            const result = await resp.json();
                            console.log('[Neo Gallery] Reverse prompt API response:', result);
                            if (result.status === "success") {
                                image.txt_content = result.prompt || "";
                                console.log('[Neo Gallery] Set image.txt_content to:', image.txt_content.substring(0, 100));
                                showToast(gallery.app, "success", "\u2705 \u53CD\u63A8\u6210\u529F", "");
                            } else {
                                showToast(gallery.app, "error", "\u274C \u53CD\u63A8\u5931\u8D25", result.error || "");
                                reverseBtn.textContent = "\uD83D\uDD0D 反推";
                                reverseBtn.style.pointerEvents = "auto";
                            }
                        } else {
                            const err = await resp.json().catch(() => ({}));
                            showToast(gallery.app, "error", "\u274C \u53CD\u63A8\u5931\u8D25", err.error || "");
                            reverseBtn.textContent = "\uD83D\uDD0D 反推";
                            reverseBtn.style.pointerEvents = "auto";
                        }
                    } catch (err) {
                        showToast(gallery.app, "error", "\u274C \u53CD\u63A8\u8BF7\u6C42\u5931\u8D25", err.message);
                        reverseBtn.textContent = "\uD83D\uDD0D 反推";
                        reverseBtn.style.pointerEvents = "auto";
                    }
                }
            }, ["\uD83D\uDD0D 反推"]);
            container.appendChild(reverseBtn);
        }

        container.appendChild(imgWrapper);
        if (promptSection) container.appendChild(promptSection);
        container.appendChild(closeBtn);
        lightbox.appendChild(container);
        document.body.appendChild(lightbox);

        gallery.currentLightbox = lightbox;
        gallery.currentLightboxImages = allImages;
        gallery.currentLightboxIndex = currentIndex;

        const handleKeyDown = (e) => {
            switch (e.key) {
                case 'ArrowLeft':
                    gallery.navigateLightboxImage(-1);
                    break;
                case 'ArrowRight':
                    gallery.navigateLightboxImage(1);
                    break;
                case 'Escape':
                    gallery.closeLightbox();
                    break;
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        gallery.currentLightboxKeyboardHandler = handleKeyDown;
    }

    closeLightbox(gallery) {
        if (gallery.currentLightbox) {
            gallery.currentLightbox.remove();
            gallery.currentLightbox = null;
        }
        if (gallery.currentLightboxKeyboardHandler) {
            document.removeEventListener('keydown', gallery.currentLightboxKeyboardHandler);
            gallery.currentLightboxKeyboardHandler = null;
        }
    }

    navigateLightboxImage(gallery, direction) {
        if (!gallery.currentLightbox || !gallery.currentLightboxImages || gallery.currentLightboxImages.length === 0) return;

        const newIndex = gallery.currentLightboxIndex + direction;
        if (newIndex < 0 || newIndex >= gallery.currentLightboxImages.length) return;

        const nextItem = gallery.currentLightboxImages[newIndex];
        gallery.updateLightboxContent(gallery.currentLightbox, nextItem, nextItem.subfolder, gallery.currentLightboxImages, newIndex);
    }

    updateLightboxContent(lightbox, image, subfolder, allImages, currentIndex) {
        // 使用 document.querySelector 而不是在 wrapped element 上调用 querySelector
        const container = document.querySelector('#neo-gallery-lightbox-container');
        if (!container) {
            this.gallery.closeLightbox();
            setTimeout(() => this.gallery.showLightbox(image, subfolder), 100);
            return;
        }

        const imgWrapper = container.querySelector('#neo-gallery-lightbox-img-wrapper');
        if (!imgWrapper) {
            this.gallery.closeLightbox();
            setTimeout(() => this.gallery.showLightbox(image, subfolder), 100);
            return;
        }

        const isVideo = isVideoFile(image.filename);
        const categoryParam = image.category ? `&category=${encodeURIComponent(image.category)}` : '';
        const newMediaUrl = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}${categoryParam}`;
        const newVideoUrl = `${window.location.protocol}//${window.location.host}/neo_gallery/video?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}`;

        const existingMedia = imgWrapper.querySelector('video, img');

        if (existingMedia) {
            // Stop any playing video
            if (existingMedia.tagName === 'VIDEO') {
                existingMedia.pause();
                existingMedia.remove();
            }

            // Create new media element
            let newMediaEl;
            if (isVideo) {
                newMediaEl = document.createElement('video');
                newMediaEl.className = "neo-gallery-lightbox-image neo-gallery-lightbox-video";
                newMediaEl.src = newVideoUrl;
                newMediaEl.controls = true;
                newMediaEl.autoplay = true;
                newMediaEl.loop = true;
                newMediaEl.style.maxWidth = '100%';
                newMediaEl.style.maxHeight = '80vh';
            } else {
                newMediaEl = document.createElement('img');
                newMediaEl.className = "neo-gallery-lightbox-image";
                newMediaEl.src = newMediaUrl + (newMediaUrl.includes('?') ? '&' : '?') + 'v=' + Date.now();
            }

            // Replace old element
            imgWrapper.replaceChild(newMediaEl, existingMedia);

            // Update image info
            const infoEl = container.querySelector('.neo-gallery-lightbox-image-info');
            if (infoEl) {
                if (isVideo) {
                    newMediaEl.onloadedmetadata = () => {
                        infoEl.textContent = `${newMediaEl.videoWidth} \u00d7 ${newMediaEl.videoHeight}`;
                    };
                } else {
                    newMediaEl.onload = () => {
                        infoEl.textContent = `${newMediaEl.naturalWidth} \u00d7 ${newMediaEl.naturalHeight}`;
                    };
                }
            }
        }

        let promptSection = container.querySelector('#neo-gallery-lightbox-prompt-section');

        if (image.txt_content) {
            // 从"无提示词"变为"有提示词"时，移除旧的反推按钮
            const oldReverseBtn = container.querySelector('#neo-gallery-lightbox-reverse-btn');
            if (oldReverseBtn) oldReverseBtn.remove();

            // 如果 promptSection 已存在（从反推状态切换），先将其从 DOM 中移除再重建
            if (promptSection && promptSection.parentNode) {
                promptSection.remove();
            }

            // 创建新的 promptSection
            const sections = this.gallery.parsePromptSections(image.txt_content);
            promptSection = $el("div", {
                id: "neo-gallery-lightbox-prompt-section",
                className: "neo-gallery-lightbox-prompt-section"
            });

            const promptContainer = $el("div", { className: "neo-gallery-lightbox-prompt-container" });

            if (sections.length > 0 && sections.some(s => s.label)) {
                for (const section of sections) {
                    if (section.label) {
                        const sectionEl = $el("div", { className: "neo-gallery-lightbox-prompt-section-item" }, [
                            $el("span", { className: "neo-gallery-lightbox-prompt-label", textContent: section.label + "\uff1a" }),
                            $el("span", { className: "neo-gallery-lightbox-prompt-value", textContent: section.value })
                        ]);
                        promptContainer.appendChild(sectionEl);
                    } else if (section.value) {
                        promptContainer.appendChild($el("div", {
                            textContent: section.value,
                            style: { marginBottom: "3px", whiteSpace: "pre-wrap" }
                        }));
                    }
                }
            } else {
                promptContainer.appendChild($el("div", {
                    textContent: this.gallery.cleanText(image.txt_content),
                    style: { whiteSpace: "pre-wrap" }
                }));
            }

            promptSection.appendChild(promptContainer);

            // 始终创建按钮容器
            const sendBtn = image.txt_content ? $el("div", {
                className: "neo-gallery-lightbox-btn neo-gallery-lightbox-send-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    this.gallery._showSendMenu(image, sendBtn);
                }
            }, ["\u2708\uFE0F Send"]) : null;

            const copyBtn = $el("div", {
                className: "neo-gallery-lightbox-btn neo-gallery-lightbox-copy-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    this.copyToClipboard(image.name, image.txt_content, copyBtn);
                }
            }, ["\u29C9 Copy"]);

            const promptBtnsContainer = $el("div", { className: "neo-gallery-lightbox-prompt-btns" });
            if (sendBtn) promptBtnsContainer.appendChild(sendBtn);
            if (isVideo) {
                const vSendBtn = $el("div", {
                    className: "neo-gallery-lightbox-btn neo-gallery-lightbox-video-send-btn",
                    onclick: (e) => {
                        e.stopPropagation();
                        this.gallery._showVideoSendMenu(this.gallery, image, vSendBtn);
                    }
                }, ["\uD83D\uDCE5 Video"]);
                promptBtnsContainer.appendChild(vSendBtn);
            }
            promptBtnsContainer.appendChild(copyBtn);
            promptSection.appendChild(promptBtnsContainer);

            // 将新的 promptSection 追加到 container（在 imgWrapper 之后）
            const imgWrapper = container.querySelector('#neo-gallery-lightbox-img-wrapper');
            if (imgWrapper && imgWrapper.nextSibling) {
                container.insertBefore(promptSection, imgWrapper.nextSibling);
            } else {
                container.appendChild(promptSection);
            }
        } else {
            // 反推按钮：暂时隐藏（待修复图片消失问题后重新启用）
            const reverseBtn = $el("div", {
                id: "neo-gallery-lightbox-reverse-btn",
                className: "neo-gallery-lightbox-btn neo-gallery-lightbox-reverse-btn",
                style: { display: 'none' },
                onclick: async (e) => {
                    e.stopPropagation();
                    try {
                        reverseBtn.textContent = "\u231B 反推中...";
                        reverseBtn.style.pointerEvents = "none";
                        const resp = await api.fetchApi('/rs_prompts/reverse_prompt', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename: image.filename, subfolder: subfolder })
                        });
                        if (resp.ok) {
                            const result = await resp.json();
                            if (result.status === "success") {
                                image.txt_content = result.prompt || "";
                                showToast(this.gallery.app, "success", "\u2705 \u53CD\u63A8\u6210\u529F", "");
                            } else {
                                showToast(gallery.app, "error", "\u274C \u53CD\u63A8\u5931\u8D25", result.error || "");
                                reverseBtn.textContent = "\uD83D\uDD0D 反推";
                                reverseBtn.style.pointerEvents = "auto";
                            }
                        } else {
                            const err = await resp.json().catch(() => ({}));
                            showToast(this.gallery.app, "error", "\u274C \u53CD\u63A8\u5931\u8D25", err.error || "");
                            reverseBtn.textContent = "\uD83D\uDD0D 反推";
                            reverseBtn.style.pointerEvents = "auto";
                        }
                    } catch (err) {
                        showToast(this.gallery.app, "error", "\u274C \u53CD\u63A8\u8BF7\u6C42\u5931\u8D25", err.message);
                        reverseBtn.textContent = "\uD83D\uDD0D 反推";
                        reverseBtn.style.pointerEvents = "auto";
                    }
                }
            }, ["\uD83D\uDD0D 反推"]);
            container.appendChild(reverseBtn);
        }

        const prevBtn = imgWrapper.querySelector('#neo-gallery-lightbox-prev-btn');
        const nextBtn = imgWrapper.querySelector('#neo-gallery-lightbox-next-btn');

        if (prevBtn) {
            prevBtn.style.opacity = currentIndex > 0 ? "0.8" : "0.3";
            prevBtn.style.cursor = currentIndex > 0 ? "pointer" : "not-allowed";
            if (currentIndex > 0) {
                prevBtn.onclick = (e) => {
                    e.stopPropagation();
                    const prevItem = allImages[currentIndex - 1];
                    this.gallery.updateLightboxContent(lightbox, prevItem, prevItem.subfolder, allImages, currentIndex - 1);
                };
            } else {
                prevBtn.onclick = null;
            }
        }
        if (nextBtn) {
            nextBtn.style.opacity = currentIndex < allImages.length - 1 ? "0.8" : "0.3";
            nextBtn.style.cursor = currentIndex < allImages.length - 1 ? "pointer" : "not-allowed";
            if (currentIndex < allImages.length - 1) {
                nextBtn.onclick = (e) => {
                    e.stopPropagation();
                    const nextItem = allImages[currentIndex + 1];
                    this.gallery.updateLightboxContent(lightbox, nextItem, nextItem.subfolder, allImages, currentIndex + 1);
                };
            } else {
                nextBtn.onclick = null;
            }
        }

        this.gallery.currentLightboxIndex = currentIndex;
    }
}
