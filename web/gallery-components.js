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
    getImageSrc,
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
        } catch(e) {}

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
                            try { await gallery.loadGallery(); gallery.sortAndDisplayImages(); } catch(e) {}
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
                                    try { await gallery.loadGallery(); gallery.sortAndDisplayImages(); } catch(e) {}
                                } else {
                                    alert('Failed: ' + (result.error || 'Unknown error'));
                                }
                            } else {
                                alert(result.error || 'Could not resolve input directory');
                            }
                        } else {
                            alert('Failed to get ComfyUI input path');
                        }
                    } catch(e) {
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
                                    try { await gallery.loadGallery(); gallery.sortAndDisplayImages(); } catch(e) {}
                                } else {
                                    alert('Failed: ' + (saveResult.error || 'Unknown error'));
                                }
                            } else {
                                alert(result.error || 'Could not resolve output directory');
                            }
                        } else {
                            alert('Failed to get ComfyUI output path');
                        }
                    } catch(e) {
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
                        } catch(e) {}
                    }

                    if (successCount > 0) {
                        textarea.value = '';
                        setTimeout(() => gallery.promptAndSetCustomDir(), 300);
                        try { await gallery.loadGallery(); gallery.sortAndDisplayImages(); } catch(e) {}
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

    // ====== Target Node Dropdown ======

    createUseSelectedNodeCheckbox(gallery) {
        const container = $el("div", {
            className: "neo-gallery-use-selected-checkbox",
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap'
            }
        });

        const checkbox = $el("input", {
            type: "checkbox",
            id: "use-selected-node",
            checked: false,
            title: "Use the currently selected node as the target"
        });

        const label = $el("label", {
            htmlFor: "use-selected-node",
            textContent: "Use Selected",
            style: {
                fontSize: '12px',
                color: '#ccc',
                cursor: 'pointer'
            }
        });

        container.appendChild(checkbox);
        container.appendChild(label);
        return container;
    }

    createTargetNodeDropdown(gallery) {
        const dropdown = $el("select", {
            id: "target-node-dropdown",
            className: "neo-gallery-target-dropdown",
            title: "Target for prompt insertion: where the gallery prompt will be sent"
        });

        dropdown.appendChild($el("option", {
            value: "",
            textContent: "Select prompt target...",
            className: "neo-gallery-dropdown-placeholder"
        }));

        dropdown.appendChild($el("option", { value: "selected", textContent: "\u2B50 Active Selected Text Node", id: "selected-node-option" }));

        const updateDropdownOptions = () => {
            while (dropdown.children.length > 2) {
                dropdown.removeChild(dropdown.lastChild);
            }

            const activeOption = dropdown.querySelector('#selected-node-option');
            if (activeOption) {
                activeOption.textContent = '\u2B50 Active Selected Text Node';
                activeOption.style.display = '';
            }

            gallery.app.graph._nodes.forEach(node => {
                const validTextWidgets = [];

                if (node.widgets) {
                    node.widgets.forEach((widget, index) => {
                        const widgetName = (widget.name || '').toLowerCase();
                        if (/negative/.test(widgetName)) return;
                        if (widget.inputEl && /string|text|custom/.test(widget.type || '')) {
                            validTextWidgets.push({ widget, index });
                        }
                    });
                }
                if (validTextWidgets.length > 0) {
                    validTextWidgets.forEach(({ widget, index }) => {
                        dropdown.appendChild($el("option", {
                            value: `${node.id}:widget:${index}`,
                            textContent: `\u25B8 ${node.title || 'Node'} \u2192 ${widget.name}`
                        }));
                    });
                }
            });
        };

        updateDropdownOptions();
        gallery.app.graph.onNodeAdded = updateDropdownOptions;
        gallery.app.graph.onNodeRemoved = updateDropdownOptions;
        return dropdown;
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

    async _showImgSendMenu(gallery, image, button) {
        gallery._removeImgSendMenu();
        if (!/\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i.test(image.filename)) {
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
            const hasImageWidget = sn.widgets && sn.widgets.some(w => /image|upload/.test((w.name||'').toLowerCase()));
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
            if (sn && sn.widgets && sn.widgets.some(w => !/negative/.test((w.name||'').toLowerCase()) && w.inputEl && /string|text|custom/.test(w.type||''))) {
                selectedNodeId = sn.id;
            }
        }
        if (menuItems.length === 0 && !selectedNodeId) {
            showToast(gallery.app, 'warning', 'No Target', 'No valid text nodes found.');
            return;
        }
        
        menuItems.forEach(item => {
            item.isSelected = item.nodeId === selectedNodeId;
        });
        menuItems.sort((a, b) => {
            if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
            if (a.isNeoPrompt !== b.isNeoPrompt) return a.isNeoPrompt ? -1 : 1;
            return 0;
        });
        
        if (menuItems.length === 1 && !selectedNodeId) {
            const item = menuItems[0];
            const s = document.getElementById("target-node-dropdown");
            if (s) s.value = `${item.nodeId}:widget:${item.widgetIndex}`;
            this.copyToClipboard(image.name, image.txt_content, button, 'send');
            return;
        }
        
        const dropdown = $el("div", { id: "neo-gallery-send-menu", className: "neo-gallery-send-menu" });
        for (const item of menuItems) {
            const label = item.isSelected ? `${item.label} \u2713` : item.label;
            const el = $el("div", {
                className: "neo-gallery-send-menu-item" + (item.isSelected ? " neo-gallery-send-menu-selected" : ""),
                onclick: (e) => { e.stopPropagation(); gallery._removeSendMenu(); const s = document.getElementById("target-node-dropdown"); if (s) s.value = `${item.nodeId}:widget:${item.widgetIndex}`; this.copyToClipboard(image.name, image.txt_content, button, 'send'); },
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

    copyToClipboard(imageName, txtContent, feedbackBtn = null, actionType = 'send') {
        let textToCopy = String(txtContent || "").trim();
        textToCopy = this.gallery.cleanText(textToCopy);

        const useSelectedNode = document.getElementById("use-selected-node")?.checked;
        const selectedValue = document.getElementById("target-node-dropdown")?.value;

        let targetNodeIds = [];
        let isPromptNode = false;
        let targetNode = null;
        let targetWidget = null;

        if (useSelectedNode) {
            const selectedKeys = Object.keys(this.gallery.app.canvas.selected_nodes);
            if (selectedKeys.length > 0) {
                targetNode = this.gallery.app.canvas.selected_nodes[selectedKeys[0]];
                if (targetNode && targetNode._rsPromptUIElements) {
                    isPromptNode = true;
                    targetNodeIds.push(parseInt(selectedKeys[0]));
                }
                if (!isPromptNode && targetNode) {
                    targetWidget = targetNode.widgets?.find(w => ['string', 'text', 'customtext'].includes(w.type));
                }
            }
        } else if (selectedValue && selectedValue !== "clipboard") {
            const [nodeId, , index] = selectedValue.split(':');
            targetNode = this.gallery.app.graph.getNodeById(parseInt(nodeId));
            targetWidget = targetNode?.widgets?.[parseInt(index)];
            if (targetNode && targetNode._rsPromptUIElements) {
                isPromptNode = true;
                targetNodeIds.push(parseInt(nodeId));
            }
        }

        if (targetNode && isPromptNode && targetNode._rsPromptUIElements) {
            const { customTextarea, textWidget } = targetNode._rsPromptUIElements;
            if (customTextarea) {
                customTextarea.value = textToCopy;
                customTextarea.dispatchEvent(new Event("input", { bubbles: true }));
            }
            if (textWidget) {
                textWidget.value = textToCopy;
            }
            this.gallery.app.graph.setDirtyCanvas(true, true);
            if (feedbackBtn) {
                showInlineFeedback(feedbackBtn, '\u2705 Sent!', 'success');
            } else {
                showToast(this.gallery.app, 'success', 'Tags Sent!', `Sent to ${targetNode.title || 'Node'}`);
            }
        } else if (targetNode && targetWidget) {
            targetWidget.value = textToCopy;
            try {
                if (targetNode.onWidgetChanged) targetNode.onWidgetChanged(targetWidget.name, targetWidget.value);
            } catch (e) {
                console.warn('[Neo Gallery] onWidgetChanged error:', e);
            }
            this.gallery.app.graph.setDirtyCanvas(true, true);
            if (feedbackBtn) {
                showInlineFeedback(feedbackBtn, '\u2705 Sent!', 'success');
            } else {
                showToast(this.gallery.app, 'success', 'Tags Sent!', `Sent to ${targetNode.title} - ${targetWidget.name}`);
            }
        } else {
            navigator.clipboard.writeText(textToCopy).then(() => {
                if (feedbackBtn) {
                    const msg = actionType === 'send' ? '\u2705 Sent!' : '\u2705 Copied!';
                    showInlineFeedback(feedbackBtn, msg, 'success');
                } else {
                    showToast(this.gallery.app, 'success', actionType === 'send' ? 'Tags Sent!' : 'Tags Copied!', `Tags for "${imageName}" ${actionType === 'send' ? 'sent to' : 'copied to'} clipboard`);
                }
            }).catch((err) => {
                if (feedbackBtn) {
                    showInlineFeedback(feedbackBtn, '\u274C Failed', 'error');
                } else {
                    showToast(this.gallery.app, 'error', actionType === 'send' ? 'Send Failed' : 'Copy Failed', `Failed to ${actionType === 'send' ? 'send' : 'copy'} tags`);
                }
            });
        }
    }

    // ====== Card Creation ======

    async createDirCard(gallery, name, path, items, subdirs = {}) {
        const imageItems = items.filter(i => isImageFile(i.filename));
        const coverImages = imageItems.slice(0, 2);
        
        const card = $el("div", {
            className: "neo-gallery-category-card",
            onclick: () => gallery.showDirectoryStructure(name, [])
        });

        const coverWrapper = await buildCoverGrid(coverImages, name, gallery);

        const info = $el("div", { className: "neo-gallery-card-info" }, [
            $el("span", { className: "neo-gallery-card-name", textContent: name }),
            $el("span", { className: "neo-gallery-card-count", textContent: `${items.length} items` })
        ]);

        const typeBadge = $el("div", {
            className: "neo-gallery-card-type-badge type-directory",
            title: "Directory"
        }, ["\uD83D\uDCC1"]);

        const deleteBtn = $el("div", {
            className: "neo-gallery-card-delete-btn",
            title: `Remove directory "${name}"`,
            onclick: (e) => {
                e.stopPropagation();
                gallery.removeCustomDir(path);
            }
        }, ["\u00D7"]);

        card.appendChild(typeBadge);
        card.appendChild(coverWrapper);
        card.appendChild(info);
        card.appendChild(deleteBtn);

        return card;
    }

    async createPresetCategoryCard(gallery, title, items, category = '') {
        const imageItems = items.filter(i => isImageFile(i.filename));
        const coverImages = imageItems.slice(0, 2);
        
        const card = $el("div", {
            className: "neo-gallery-category-card",
            onclick: () => gallery.showPresetCategory(category, title)
        });

        const coverWrapper = await buildCoverGrid(coverImages, 'presets', gallery, '\uD83C\uDFA8', 'neo-gallery-card-cover neo-gallery-card-placeholder');

        const typeBadge = $el("div", {
            className: "neo-gallery-card-type-badge type-directory",
            title: "Directory"
        }, ["\uD83D\uDCC1"]);

        const info = $el("div", { className: "neo-gallery-card-info" }, [
            $el("span", { className: "neo-gallery-card-name", textContent: title }),
            $el("span", { className: "neo-gallery-card-count", textContent: `${items.length} items` })
        ]);

        card.appendChild(typeBadge);
        card.appendChild(coverWrapper);
        card.appendChild(info);
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

        // Fetch directory structure asynchronously
        setTimeout(async () => {
            try {
                const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(parentDir)}&path=${encodeURIComponent(fullPath.join("/"))}`);
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

                if (structure.images && structure.images.length > 0) {
                    let currentSubfolder;
                    if (fullPath.length > 0) {
                        currentSubfolder = parentDir + "/" + fullPath.join("/");
                    } else {
                        currentSubfolder = parentDir;
                    }
                    
                    const coverImages = structure.images.slice(0, 2);
                    coverWrapper.innerHTML = '';
                    
                    const coverGrid = $el("div", { className: "neo-gallery-card-cover-grid" });
                    
                    let loadedCount = 0;
                    coverImages.forEach((imgData) => {
                        const src = getImageSrc(imgData, currentSubfolder);
                        
                        const imgItem = $el("div", { className: "neo-gallery-card-cover-grid-item" });
                        
                        const img = $el("img", {
                            src: src,
                            alt: subdirName,
                            loading: "lazy"
                        });
                        
                        img.onload = () => {
                            loadedCount++;
                            if (loadedCount === coverImages.length) {
                                const height = getCoverHeight(coverWrapper, gallery);
                                coverGrid.style.height = `${height * 2}px`;
                            }
                        };
                        
                        img.onerror = () => {
                            imgItem.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:24px;">\uD83D\uDCC1</div>';
                        };
                        
                        imgItem.appendChild(img);
                        coverGrid.appendChild(imgItem);
                    });
                    
                    coverWrapper.appendChild(coverGrid);
                } else if (structure.subdirs && structure.subdirs.length > 0) {
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

    createImageElement(gallery, image, subfolder) {
        const src = getImageSrc(image, subfolder);
        const isImageFileResult = isImageFile(image.filename);
        const reservedSpace = getReservedSpace(gallery.displayLabels);
        const imageHeight = getImageHeight(gallery.maxThumbnailSize, gallery.displayLabels);

        const container = $el("div", {
            className: "neo-gallery-thumb-container",
            style: {
                height: `${gallery.maxThumbnailSize}px`,
                width: `${gallery.maxThumbnailSize}px`
            },
            onclick: () => gallery.showLightbox(image, subfolder)
        });

        if (isImageFileResult) {
            const img = new Image();
            img.onload = () => {
                const aspectRatio = img.height / img.width;
                container.style.width = `${Math.max(gallery.maxThumbnailSize * (1 / aspectRatio), 40)}px`;
            };
            img.src = src;
        }

        let deleteBtn = null;
        if (!['presets'].includes(subfolder)) {
            deleteBtn = $el("div", {
                className: "neo-gallery-delete-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    gallery.deleteItem(image.name, subfolder);
                }
            }, ["\u00D7"]);
        }

        const imgSendBtn = $el("div", {
            className: "neo-gallery-thumb-img-send-btn",
            onclick: (e) => {
                e.stopPropagation();
                gallery._showImgSendMenu(image, imgSendBtn);
            }
        }, ["\uD83D\uDCE4"]);

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

        let copyBtn = null;
        if (image.txt_content) {
            copyBtn = $el("div", {
                className: "neo-gallery-thumb-copy-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    this.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
                }
            }, ["\u29C9"]);
        }

        const imgEl = $el("img", {
            className: "neo-gallery-thumb-img",
            src: src,
            alt: image.name,
            onerror: () => {
                if (!image.preview) imgEl.src = gallery.placeholderImageUrl;
            }
        });

        const btnBar = $el("div", { className: "neo-gallery-thumb-btn-bar" }, [sendBtn, imgSendBtn, copyBtn].filter(Boolean));

        const imgWrapper = $el("div", { className: "neo-gallery-thumb-img-wrapper" }, [imgEl, btnBar]);

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

    injectAnimations() {}

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

        const lightbox = $el("div", {
            id: "neo-gallery-lightbox",
            className: "neo-gallery-lightbox",
            onclick: (e) => {
                if (e.target === lightbox) {
                    gallery.closeLightbox();
                }
            }
        });

        const container = $el("div", {
            id: "neo-gallery-lightbox-container",
            className: "neo-gallery-lightbox-container",
        });

        const imgWrapper = $el("div", {
            id: "neo-gallery-lightbox-img-wrapper",
            className: "neo-gallery-lightbox-img-wrapper",
        });

        const categoryParam = image.category ? `&category=${encodeURIComponent(image.category)}` : '';
        const imageUrl = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}${categoryParam}`;
        const img = $el("img", {
            className: "neo-gallery-lightbox-image",
            src: imageUrl,
        });

        const closeBtn = $el("div", {
            className: "neo-gallery-lightbox-close-btn",
            onclick: (e) => {
                e.stopPropagation();
                gallery.closeLightbox();
            }
        }, ["\u00D7"]);

        const navBtns = $el("div", { className: "neo-gallery-lightbox-nav-btns" });

        let sendBtn = null;
        if (image.txt_content) {
            sendBtn = $el("div", {
                className: "neo-gallery-lightbox-btn neo-gallery-lightbox-send-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    gallery._showSendMenu(image, sendBtn);
                }
            }, ["\u2708\uFE0F Send"]);
        }

        const copyBtn = $el("div", {
            className: "neo-gallery-lightbox-btn neo-gallery-lightbox-copy-btn",
            onclick: (e) => {
                e.stopPropagation();
                this.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
            }
        }, ["\u29C9 Copy"]);

        imgWrapper.appendChild(img);

        const imageInfo = $el("div", { className: "neo-gallery-lightbox-image-info" });
        img.onload = () => {
            if (imageInfo) {
                imageInfo.textContent = `${img.naturalWidth} \u00d7 ${img.naturalHeight}`;
            }
        };
        imgWrapper.appendChild(imageInfo);

        // Build all images list for navigation
        const allImages = [];
        const { source, categoryPath, mode } = gallery.currentView;
        
        if (source === 'presets') {
            const catToMatch = gallery._presetRawCategory || '';
            const presetItems = gallery.isSearchActive ? gallery.filteredPresets : gallery.allPresets;
            // Build full subfolder path for presets: "presets/26-06-26/images"
            const presetSubfolder = categoryPath && categoryPath.length > 0 ? "presets/" + categoryPath.join("/") : "presets";
            for (const p of presetItems) {
                if (p.category === catToMatch) {
                    allImages.push({...p, subfolder: presetSubfolder});
                }
            }
        } else if (source && mode !== 'categories') {
            const dir = gallery.allCustomDirs.find(d => d.name === source);
            if (dir) {
                let dirItems = [...dir.items];
                if (categoryPath && categoryPath.length > 0) {
                    const catKey = categoryPath[0];
                    dirItems = dirItems.filter(i => i.category === catKey || (!i.category && !catKey));
                }
                for (const item of dirItems) {
                    allImages.push({...item, subfolder: source});
                }
            }
        } else {
            for (const dir of gallery.allCustomDirs) {
                if (!gallery.isSearchActive || gallery.filteredCustomDirs.some(d => d.name === dir.name)) {
                    for (const item of dir.items) {
                        allImages.push({...item, subfolder: dir.name});
                    }
                }
            }
            
            const presetItems = gallery.isSearchActive ? gallery.filteredPresets : gallery.allPresets;
            for (const p of presetItems) {
                allImages.push({...p, subfolder: "presets"});
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

            const sections = gallery.parsePromptSections(image.txt_content);
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
            promptBtnsContainer.appendChild(sendBtn);
            promptBtnsContainer.appendChild(copyBtn);
            promptSection.appendChild(promptBtnsContainer);
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

    updateLightboxContent(gallery, lightbox, image, subfolder, allImages, currentIndex) {
        const container = lightbox.querySelector('#neo-gallery-lightbox-container');
        if (!container) {
            gallery.closeLightbox();
            setTimeout(() => gallery.showLightbox(image, subfolder), 100);
            return;
        }

        const imgWrapper = container.querySelector('#neo-gallery-lightbox-img-wrapper');
        if (!imgWrapper) {
            gallery.closeLightbox();
            setTimeout(() => gallery.showLightbox(image, subfolder), 100);
            return;
        }

        const img = imgWrapper.querySelector('img');
        const categoryParam = image.category ? `&category=${encodeURIComponent(image.category)}` : '';
        const newImageUrl = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}${categoryParam}`;

        if (img) {
            img.style.opacity = '0';
            img.style.transform = 'scale(1)';
            
            setTimeout(() => {
                img.src = newImageUrl;
                img.onload = () => {
                    img.style.opacity = '1';
                    
                    const infoEl = container.querySelector('.neo-gallery-lightbox-image-info');
                    if (infoEl) {
                        infoEl.textContent = `${img.naturalWidth} \u00d7 ${img.naturalHeight}`;
                    }
                };
            }, 150);
        }

        let promptSection = container.querySelector('#neo-gallery-lightbox-prompt-section');
        
        if (image.txt_content) {
            if (!promptSection) {
                promptSection = $el("div", {
                    id: "neo-gallery-lightbox-prompt-section",
                    className: "neo-gallery-lightbox-prompt-section"
                });
                container.appendChild(promptSection);
            }
            
            promptSection.innerHTML = '';
            
            const sections = gallery.parsePromptSections(image.txt_content);
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
            
            let promptBtnsContainer = promptSection.querySelector('.neo-gallery-lightbox-prompt-btns');
            if (!promptBtnsContainer) {
                promptBtnsContainer = $el("div", { className: "neo-gallery-lightbox-prompt-btns" });
                
                const sendBtn = $el("div", {
                    className: "neo-gallery-lightbox-btn neo-gallery-lightbox-send-btn",
                    onclick: (e) => {
                        e.stopPropagation();
                        gallery._showSendMenu(image, sendBtn);
                    }
                }, ["\u2708\uFE0F Send"]);
                
                const copyBtn = $el("div", {
                    className: "neo-gallery-lightbox-btn neo-gallery-lightbox-copy-btn",
                    onclick: (e) => {
                        e.stopPropagation();
                        this.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
                    }
                }, ["\u29C9 Copy"]);
                
                promptBtnsContainer.appendChild(sendBtn);
                promptBtnsContainer.appendChild(copyBtn);
                promptSection.appendChild(promptBtnsContainer);
            }
        } else if (promptSection && !image.txt_content) {
            promptSection.remove();
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
                    gallery.updateLightboxContent(lightbox, prevItem, prevItem.subfolder, allImages, currentIndex - 1);
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
                    gallery.updateLightboxContent(lightbox, nextItem, nextItem.subfolder, allImages, currentIndex + 1);
                };
            } else {
                nextBtn.onclick = null;
            }
        }

        gallery.currentLightboxIndex = currentIndex;
    }
}