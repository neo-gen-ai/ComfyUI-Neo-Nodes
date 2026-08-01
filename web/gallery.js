import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { $el } from "../../../../scripts/ui.js";

// Load gallery CSS
const galleryCssLink = document.createElement('link');
galleryCssLink.rel = 'stylesheet';
galleryCssLink.href = "/extensions/ComfyUI-Neo-Nodes/gallery.css";
document.head.appendChild(galleryCssLink);

/**
 * NeoGallery — preset-based gallery (no YAML).
 */
class NeoGallery {
    constructor(app) {
        this.app = app;
        this.maxThumbnailSize = 300;
        this.displayLabels = true;
        // New data structure: custom_dirs grouped by dir name
        this.allCustomDirs = [];   // [{name, path, items: [...]}, ...]
        this.allPresets = [];
        this.filteredCustomDirs = [];
        this.filteredPresets = [];
        this.sortAscending = true;
        this.searchInput = this.createSearchInput();
        this.targetNodeDropdown = this.createTargetNodeDropdown();
        this.thumbnailSizeSlider = this.createThumbnailSizeSlider();
        this.customDirSettingBtn = null;
        // Card-based layout state
        this.currentView = {
            mode: 'categories',  // 'categories' | 'images'
            source: null,        // dir name or 'presets'
            categoryPath: [],    // breadcrumb path segments
        };
        this.placeholderImageUrl = `${window.location.protocol}//${window.location.host}/neo_gallery/placeholder.png`;
        this.sectionStates = {};
        this.isSearchActive = false;

        // Use a unique ID so we can find and clean up old instances across all containers
        this.elementId = "neo-gallery-panel-root";

        // Create the custom dir setting button (will be populated after settings load)
        this.customDirInput = $el("input", {
            type: "text",
            value: "",
            readonly: true,
            className: "neo-gallery-custom-dir-input-inline",
            style: { display: "none" } // hidden, used only for value storage
        });

        const customDirBtn = this.createCustomDirSettingBtn();
        const randomPromptBtn = this.createRandomPromptBtn();

        // Main content area for gallery cards/images
        this.accordion = $el("div", { className: "neo-gallery-accordion" });

        this.element = $el("div", { id: this.elementId, className: "neo-gallery-panel" }, [
            // Header row — title left (col1), spacer (col2), buttons right (col3)
            $el("div", { 
                className: "neo-gallery-header-row",
                style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center' }
            }, [
                $el("h3", { className: "neo-gallery-header-title", textContent: "Neo Gallery" }),
                $el("div", { 
                    style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, gridColumn: '2' }
                }, [this.thumbnailSizeSlider]),
                $el("div", { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, [customDirBtn, randomPromptBtn])
            ]),
            // Search and target row
            $el("div", { className: "neo-gallery-search-row" }, [
                $el("div", { className: "neo-gallery-search-container" }, [this.searchInput]),
                $el("div", { className: "neo-gallery-dropdown-container" }, [this.targetNodeDropdown])
            ]),
            // Breadcrumb navigation (shown when viewing category images)
            $el("div", { 
                id: "neo-gallery-breadcrumb",
                className: "neo-gallery-breadcrumb",
                style: { display: 'none' }
            }, [this.createBreadcrumbHome()]),
            // Main content area (cards or expanded images)
            this.accordion,
            this.customDirInput
        ]);

        // Load custom directory settings from backend (sets the button text)
        this.loadGallerySettings();
    }

    createRandomPromptBtn() {
        const btn = $el("button", {
            className: "neo-gallery-random-btn",
            title: "Random Prompt",
            style: { marginLeft: '8px' },
            onclick: (e) => {
                e.stopPropagation();
                this.generateRandomPrompt();
            },
            textContent: "\uD83C\uDFB2"
        });
        return btn;
    }

    createCustomDirSettingBtn() {
        const btn = $el("button", {
            className: "neo-gallery-custom-dir-btn",
            title: "Set custom directory",
            onclick: async () => await this.promptAndSetCustomDir(),
            textContent: "+"
        });
        this.customDirSettingBtn = btn;
        return btn;
    }

    // ====== Breadcrumb Navigation ======

    createBreadcrumbHome() {
        const homeBtn = $el("span", {
            className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-home",
            textContent: "\uD83C\uDFE0",
            onclick: (e) => {
                e.stopPropagation();
                this.showCategoryCards();
            }
        });
        return homeBtn;
    }

    updateBreadcrumb(pathSegments, sourceName) {
        const breadcrumb = document.getElementById("neo-gallery-breadcrumb");
        if (!breadcrumb) return;

        // Remove any existing sibling dropdowns first
        this._removeSiblingDropdown();

        // Determine the root directory name for this navigation context
        const rootDirName = this.currentView.source || '';
        
        if (pathSegments.length === 0 && !sourceName && !rootDirName) {
            // Show only home button
            breadcrumb.style.display = 'flex';
            breadcrumb.innerHTML = '';
            breadcrumb.appendChild(this.createBreadcrumbHome());
            return;
        }

        breadcrumb.style.display = 'flex';
        breadcrumb.innerHTML = '';
        
        // Home button - goes back to category cards view (left side)
        const homeBtn = $el("span", {
            className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-home",
            textContent: "\uD83C\uDFE0",
            onclick: (e) => {
                e.stopPropagation();
                this.showCategoryCards();
            }
        });
        breadcrumb.appendChild(homeBtn);

        // For directory navigation, show full path as segments
        if (rootDirName) {
            const sep1 = $el("span", { className: "neo-gallery-breadcrumb-sep", textContent: ">" });
            breadcrumb.appendChild(sep1);
            
            // Root directory is clickable to go back to dir root
            if (pathSegments.length > 0) {
                breadcrumb.appendChild($el("span", {
                    className: "neo-gallery-breadcrumb-item",
                    textContent: rootDirName,
                    onclick: (e) => {
                        e.stopPropagation();
                        this.showDirectoryStructure(rootDirName, []);
                    }
                }));
            } else {
                breadcrumb.appendChild($el("span", {
                    className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-current",
                    textContent: rootDirName
                }));
            }

            // Separator and path segments (subdirectories)
            for (let i = 0; i < pathSegments.length; i++) {
                const sep = $el("span", { className: "neo-gallery-breadcrumb-sep", textContent: ">" });
                breadcrumb.appendChild(sep);
                
                if (i === pathSegments.length - 1) {
                    // Last segment is the current location — clickable to show sibling directories
                    const currentSegmentEl = $el("span", {
                        className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-current neo-gallery-breadcrumb-sibling-trigger",
                        textContent: pathSegments[i],
                        title: "点击显示同级目录"
                    });
                    
                    // Add click handler to show sibling dropdown
                    currentSegmentEl.onclick = (e) => {
                        e.stopPropagation();
                        this._toggleSiblingDropdown(e, rootDirName, pathSegments);
                    };
                    
                    breadcrumb.appendChild(currentSegmentEl);
                } else {
                    breadcrumb.appendChild($el("span", {
                        className: "neo-gallery-breadcrumb-item",
                        textContent: pathSegments[i],
                        onclick: (e) => {
                            e.stopPropagation();
                            this.showDirectoryStructure(rootDirName, pathSegments.slice(0, i + 1));
                        }
                    }));
                }
            }

            // Add "up" button on the right side if there are parent directories to navigate to
            if (pathSegments.length > 0) {
                const sepUp = $el("span", { className: "neo-gallery-breadcrumb-sep", textContent: "" });
                breadcrumb.appendChild(sepUp);

                // Spacer to push up button to the right
                const spacer = $el("div", { style: { flex: 1 } });
                breadcrumb.appendChild(spacer);

                // Up button - goes to parent directory
                const upBtn = $el("span", {
                    className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-up",
                    title: "上一级",
                    textContent: "\u2B06",
                    onclick: (e) => {
                        e.stopPropagation();
                        // Navigate to parent by removing the last segment
                        const parentPath = pathSegments.slice(0, -1);
                        this.showDirectoryStructure(rootDirName, parentPath);
                    }
                });
                breadcrumb.appendChild(upBtn);
            }
        } else if (sourceName) {
            // Fallback for presets view - just show source name
            const sep = $el("span", { className: "neo-gallery-breadcrumb-sep", textContent: ">" });
            breadcrumb.appendChild(sep);
            breadcrumb.appendChild($el("span", {
                className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-current",
                textContent: sourceName
            }));

            // Add up button for presets view too (go back to categories)
            if (pathSegments.length > 0 || sourceName) {
                const spacer = $el("div", { style: { flex: 1 } });
                breadcrumb.appendChild(spacer);

                const upBtn = $el("span", {
                    className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-up",
                    title: "返回上级",
                    textContent: "\u2B06",
                    onclick: (e) => {
                        e.stopPropagation();
                        this.showCategoryCards();
                    }
                });
                breadcrumb.appendChild(upBtn);
            }
        }
    }

    // ====== Sibling Directory Dropdown ======

    _removeSiblingDropdown() {
        const existing = document.getElementById('neo-gallery-sibling-dropdown');
        if (existing) existing.remove();
    }

    async _toggleSiblingDropdown(event, rootDirName, pathSegments) {
        // Remove any existing dropdown first
        this._removeSiblingDropdown();

        // If the clicked element already has a dropdown parent, close it
        const trigger = event.currentTarget;
        if (trigger.classList.contains('neo-gallery-breadcrumb-sibling-trigger')) {
            // Check if there's an open sibling dropdown near this trigger
            const existingDropdown = document.getElementById('neo-gallery-sibling-dropdown');
            if (existingDropdown) {
                existingDropdown.remove();
                return;
            }
        }

        // Get the parent directory path for fetching siblings (exclude current segment)
        const parentPath = pathSegments.slice(0, -1);
        
        console.log('[Gallery] Sibling dropdown:', { rootDirName, pathSegments, parentPath });
        
        // Fetch sibling directories from backend
        let siblings = [];
        try {
            const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(rootDirName)}&path=${encodeURIComponent(parentPath.join("/"))}`);
            if (resp.ok) {
                const structure = await resp.json();
                console.log('[Gallery] Sibling dirs response:', structure.subdirs);
                // Get subdirectories at this level — these are siblings of the current directory
                siblings = (structure.subdirs || []).map(s => ({ name: s, path: [...parentPath, s] }));
            }
        } catch (e) {
            console.error('[Gallery] Error fetching sibling directories:', e);
        }

        // Only show dropdown if there are siblings to navigate to
        if (siblings.length === 0) return;

        // Create dropdown container
        const dropdown = $el("div", {
            id: "neo-gallery-sibling-dropdown",
            className: "neo-gallery-sibling-dropdown"
        });

        // Get trigger position for positioning the dropdown
        const rect = event.target.getBoundingClientRect();
        
        // Position dropdown below the breadcrumb
        dropdown.style.position = 'fixed';
        dropdown.style.top = (rect.bottom + 4) + 'px';
        dropdown.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
        dropdown.style.zIndex = '9999';

        // Create list of sibling items
        const listContainer = $el("div", { className: "neo-gallery-sibling-list" });
        
        for (const sib of siblings) {
            const item = $el("div", {
                className: "neo-gallery-sibling-item",
                onclick: (e) => {
                    e.stopPropagation();
                    this._removeSiblingDropdown();
                    // Navigate to sibling directory
                    this.showDirectoryStructure(rootDirName, sib.path);
                },
                textContent: sib.name
            });
            
            // Add hover effect
            item.onmouseenter = () => item.classList.add('neo-gallery-sibling-item-hover');
            item.onmouseleave = () => item.classList.remove('neo-gallery-sibling-item-hover');
            
            listContainer.appendChild(item);
        }

        dropdown.appendChild(listContainer);
        document.body.appendChild(dropdown);

        // Close dropdown when clicking outside
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== trigger) {
                this._removeSiblingDropdown();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    // ====== Directory Management ======

    async loadGallerySettings() {
        try {
            const resp = await api.fetchApi('/neo_gallery/get_settings');
            if (resp.ok) {
                const settings = await resp.json();
                const customDir = settings.custom_directory || "";
                
                // Update hidden input for value storage
                this.customDirInput.value = customDir;
                
                // Update button title to show current path
                if (this.customDirSettingBtn) {
                    if (customDir) {
                        const displayName = customDir.split(/[\\/]/).pop();
                        this.customDirSettingBtn.title = customDir + '\n(Click to change)\nCurrent: ' + displayName;
                        this.customDirSettingBtn.textContent = "\uD83D\uDCC1";
                    } else {
                        this.customDirSettingBtn.title = "Set custom directory\n(Currently not configured)";
                        this.customDirSettingBtn.textContent = "+";
                    }
                }
            }
        } catch (error) {
            console.error('Error loading gallery settings:', error);
            if (this.customDirSettingBtn) {
                this.customDirSettingBtn.title = "Failed to load settings";
                this.customDirSettingBtn.textContent = "?";
            }
        }
    }

    async promptAndSetCustomDir() {
        // Remove existing modal if any
        const existingModal = document.querySelector('.neo-gallery-dir-modal');
        if (existingModal) existingModal.remove();

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
            onclick: (e) => { if (e.target === modalOverlay) this.closeDirModal(); }
        });

        const modal = $el("div", {
            className: "neo-gallery-dir-modal"
        });

        // Title bar
        const titleBar = $el("div", { className: "neo-gallery-dir-modal-titlebar" }, [
            $el("span", { className: "neo-gallery-dir-modal-title", textContent: "\uD83D\uDCC1 Manage Directories" }),
            $el("span", { 
                className: "neo-gallery-dir-modal-close",
                onclick: () => this.closeDirModal(),
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
                            await this.removeCustomDir(dirPath);
                            // Refresh modal after removal
                            setTimeout(() => this.promptAndSetCustomDir(), 300);
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

                    // Validate directory exists
                    try {
                        const resp = await api.fetchApi('/neo_gallery/save_settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: "add", path: dirPath })
                        });
                        const result = await resp.json();
                        
                        if (resp.ok && result.success) {
                            input.value = '';
                            // Refresh modal to show updated list
                            setTimeout(() => this.promptAndSetCustomDir(), 300);
                            
                            // Reload gallery in background
                            try { await this.loadGallery(); this.sortAndDisplayImages(); } catch(e) {}
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

        // Quick add buttons for common ComfyUI directories
        const quickAddArea = $el("div", { className: "neo-gallery-dir-quick-add" }, [
            $el("span", { 
                className: "neo-gallery-dir-quick-label",
                textContent: "Quick add:"
            }),
            $el("button", {
                className: "neo-gallery-dir-quick-btn neo-gallery-dir-quick-input",
                onclick: async () => {
                    try {
                        const resp = await api.fetchApi('/neo_gallery/resolve_path?path_type=input');
                        if (resp.ok) {
                            const result = await resp.json();
                            if (result.success && result.path) {
                                // Directly add to settings and refresh modal
                                const saveResp = await api.fetchApi('/neo_gallery/save_settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: "add", path: result.path })
                                });
                                const saveResult = await saveResp.json();
                                
                                if (saveResp.ok && saveResult.success) {
                                    // Refresh modal to show updated list
                                    setTimeout(() => this.promptAndSetCustomDir(), 300);
                                    
                                    // Reload gallery in background
                                    try { await this.loadGallery(); this.sortAndDisplayImages(); } catch(e) {}
                                } else {
                                    alert('Failed: ' + (saveResult.error || 'Unknown error'));
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
                                // Directly add to settings and refresh modal
                                const saveResp = await api.fetchApi('/neo_gallery/save_settings', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: "add", path: result.path })
                                });
                                const saveResult = await saveResp.json();
                                
                                if (saveResp.ok && saveResult.success) {
                                    // Refresh modal to show updated list
                                    setTimeout(() => this.promptAndSetCustomDir(), 300);
                                    
                                    // Reload gallery in background
                                    try { await this.loadGallery(); this.sortAndDisplayImages(); } catch(e) {}
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

        // Bulk add area for multiple directories
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
                        setTimeout(() => this.promptAndSetCustomDir(), 300);
                        try { await this.loadGallery(); this.sortAndDisplayImages(); } catch(e) {}
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

        // Focus the input
        setTimeout(() => {
            const input = document.getElementById('neo-gallery-new-dir-input');
            if (input) input.focus();
        }, 100);
    }

    closeDirModal() {
        const modal = document.querySelector('.neo-gallery-dir-modal-overlay');
        if (modal) modal.remove();
    }

    async removeCustomDir(dirPath) {
        if (!confirm(`Remove directory "${dirPath}" from gallery?`)) return;
        
        const saveResp = await api.fetchApi('/neo_gallery/save_settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: "remove", path: dirPath })
        });
        const result = await saveResp.json();
        
        if (saveResp.ok && result.success) {
            await this.loadGallery();
            this.sortAndDisplayImages();
        } else {
            alert('Failed to remove directory: ' + (result.error || ''));
        }
    }

    // ====== State / Persistence ======

    async savePluginData(overrides) {
        const pluginData = {
            sectionStates: this.sectionStates,
            sortAscending: this.sortAscending,
            maxThumbnailSize: this.maxThumbnailSize,
            displayLabels: this.displayLabels,
            ...overrides
        };
        try {
            await api.fetchApi('/userdata/neo_gallery_data.json', {
                method: 'POST',
                body: JSON.stringify(pluginData),
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            console.error('Error saving plugin data:', error);
        }
    }

    async loadPluginData() {
        try {
            const response = await api.fetchApi('/userdata/neo_gallery_data.json');
            if (response.ok) {
                const data = await response.json();
                this.sectionStates = data.sectionStates || {};
                this.sortAscending = data.sortAscending !== undefined ? data.sortAscending : true;
                this.maxThumbnailSize = data.maxThumbnailSize || 300;
                this.displayLabels = data.displayLabels !== undefined ? data.displayLabels : true;
            }
        } catch (error) {
            console.error('Error loading plugin data:', error);
        }
    }

    // ====== UI Builders ======

    createTargetNodeDropdown() {
        const dropdown = $el("select", {
            id: "target-node-dropdown",
            className: "neo-gallery-target-dropdown",
            title: "Target for prompt insertion: where the gallery prompt will be sent"
        });

        // Placeholder option
        dropdown.appendChild($el("option", {
            value: "",
            textContent: "Select prompt target...",
            className: "neo-gallery-dropdown-placeholder"
        }));

        // Active Selected Node option (dynamically updated)
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

            app.graph._nodes.forEach(node => {
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
        app.graph.onNodeAdded = updateDropdownOptions;
        app.graph.onNodeRemoved = updateDropdownOptions;
        return dropdown;
    }

    _removeSendMenu() {
        const existing = document.getElementById('neo-gallery-send-menu');
        if (existing) existing.remove();
    }

    async _showSendMenu(image, button) {
        this._removeSendMenu();
        const menuItems = [];
        app.graph._nodes.forEach(node => {
            if (!node.widgets) return;
            node.widgets.forEach((widget, index) => {
                const wn = (widget.name || '').toLowerCase();
                if (/negative/.test(wn)) return;
                if (widget.inputEl && /string|text|custom/.test(widget.type || '')) {
                    menuItems.push({ nodeId: node.id, widgetIndex: index, label: `\u25B8 ${node.title || 'Node'} \u2192 ${widget.name}`, isNeoPrompt: /neo.?prompt/i.test(node.title) });
                }
            });
        });
        menuItems.sort((a, b) => {
            if (a.isNeoPrompt !== b.isNeoPrompt) return a.isNeoPrompt ? -1 : 1;
            return 0;
        });
        const selKeys = Object.keys(app.canvas.selected_nodes);
        let showSelectedOption = false;
        if (selKeys.length > 0) {
            const sn = app.canvas.selected_nodes[selKeys[0]];
            if (sn && sn.widgets && sn.widgets.some(w => !/negative/.test((w.name||'').toLowerCase()) && w.inputEl && /string|text|custom/.test(w.type||''))) showSelectedOption = true;
        }
        if (menuItems.length === 0 && !showSelectedOption) { this.showToast('warning', 'No Target', 'No valid text nodes found.'); return; }
        const dropdown = $el("div", { id: "neo-gallery-send-menu", className: "neo-gallery-send-menu" });
        if (showSelectedOption) {
            const si = $el("div", { className: "neo-gallery-send-menu-item neo-gallery-send-menu-selected", onclick: (e) => { e.stopPropagation(); this._removeSendMenu(); const s = document.getElementById("target-node-dropdown"); if (s) s.value = "selected"; this.copyToClipboard(image.name, image.txt_content, button, 'send'); }, textContent: "\u2B50 Active Selected Text Node" });
            dropdown.appendChild(si);
        }
        for (const item of menuItems) {
            const el = $el("div", { className: "neo-gallery-send-menu-item", onclick: (e) => { e.stopPropagation(); this._removeSendMenu(); const s = document.getElementById("target-node-dropdown"); if (s) s.value = `${item.nodeId}:widget:${item.widgetIndex}`; this.copyToClipboard(image.name, image.txt_content, button, 'send'); }, textContent: item.label });
            dropdown.appendChild(el);
        }
        const rect = button.getBoundingClientRect();
        dropdown.style.position = 'fixed'; dropdown.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px'; dropdown.style.zIndex = '10001';
        document.body.appendChild(dropdown);
        requestAnimationFrame(() => {
            dropdown.style.top = (rect.top - dropdown.offsetHeight - 8) + 'px';
        });
        const closeHandler = (e) => { if (!dropdown.contains(e.target) && e.target !== button) { this._removeSendMenu(); document.removeEventListener('click', closeHandler); } };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    createSearchInput() {
        const input = $el("input", {
            type: "text",
            placeholder: "Search prompt images...",
            className: "neo-gallery-search-input"
        });
        input.addEventListener("input", this.debounce(() => this.handleSearch(input.value), 300));
        return input;
    }

    createThumbnailSizeSlider() {
        const valueLabel = $el("span", {
            className: "thumbnail-size-value",
            textContent: `${this.maxThumbnailSize}px`
        });

        const slider = $el("input", {
            type: "range",
            min: 150,
            max: 500,
            step: 25,
            value: this.maxThumbnailSize,
            className: "neo-gallery-thumbnail-slider",
            onchange: () => {
                const val = parseInt(slider.value);
                this.updateThumbnailSize(val);
                valueLabel.textContent = `${val}px`;
                this.savePluginData({ maxThumbnailSize: val });
            }
        });

        return $el("div", { className: "neo-gallery-slider-row" }, [$el("span", { className: "neo-gallery-size-label", textContent: "Size:" }), slider, valueLabel]);
    }

    // ====== Actions ======

    async deleteItem(name, subfolder) {
        try {
            const response = await api.fetchApi('/neo_gallery/delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: name, subfolder })
            });
            const result = await response.json();
            if (result.deleted) {
                // Remove from allCustomDirs
                for (const dir of this.allCustomDirs) {
                    dir.items = dir.items.filter(item => item.name !== name);
                }
                // Remove from presets
                this.allPresets = this.allPresets.filter(item => item.name !== name);
                
                if (this.isSearchActive) {
                    this.handleSearch(this.searchInput.value);
                } else {
                    this.sortAndDisplayImages();
                }
                this.showToast('success', 'Deleted', `Removed: ${name}`);
            } else {
                this.showToast('warning', 'Delete Failed', 'Item not found or already deleted.');
            }
        } catch (error) {
            console.error("Error deleting item:", error);
            this.showToast('error', 'Delete Failed', error.message);
        }
    }

    handleSearch(searchTerm) {
        searchTerm = searchTerm.toLowerCase();
        this.isSearchActive = searchTerm.length > 0;
        
        // Filter custom dirs by matching items
        this.filteredCustomDirs = this.allCustomDirs.map(dir => ({
            ...dir,
            items: dir.items.filter(img =>
                (img.name && img.name.toLowerCase().includes(searchTerm)) ||
                (img.style && img.style.toLowerCase().includes(searchTerm)) ||
                (img.content && img.content.toLowerCase().includes(searchTerm))
            )
        })).filter(dir => dir.items.length > 0);

        this.filteredPresets = this.allPresets.filter(img =>
            (img.name && img.name.toLowerCase().includes(searchTerm)) ||
            (img.style && img.style.toLowerCase().includes(searchTerm)) ||
            (img.content && img.content.toLowerCase().includes(searchTerm))
        );
        
        // Reset view to categories when searching
        this.currentView.mode = 'categories';
        this.currentView.source = null;
        this.currentView.categoryPath = [];
        
        this.sortAndDisplayImages();
    }

    updateThumbnailSize(newSize) {
        this.maxThumbnailSize = newSize;
        if (this.thumbnailSizeSlider) {
            const slider = this.thumbnailSizeSlider.querySelector("input[type='range']");
            const label = this.thumbnailSizeSlider.querySelector(".thumbnail-size-value");
            if (slider) slider.value = newSize;
            if (label) label.textContent = `${newSize}px`;
        }
        this.sortAndDisplayImages();
    }

    updateLabelDisplay(display) {
        this.displayLabels = display;
        this.sortAndDisplayImages();
    }

    // ====== Data Loading ======

    async loadGallery() {
        try {
            const resp = await api.fetchApi('/neo_gallery/list');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            console.log('Gallery API response:', data);
            // New format: custom_dirs grouped by directory name
            this.allCustomDirs = (data.custom_dirs || []).map(dir => ({
                name: dir.name,
                path: dir.path,
                items: dir.items || []
            }));
            this.allPresets = data.presets || [];
            console.log('Loaded custom_dirs:', this.allCustomDirs.length, 'presets:', this.allPresets.length);
            this.filteredCustomDirs = this.allCustomDirs;
            this.filteredPresets = this.allPresets;
        } catch (error) {
            console.error('Error loading gallery:', error);
            this.allCustomDirs = [];
            this.allPresets = [];
            this.filteredCustomDirs = [];
            this.filteredPresets = [];
        }
    }

    // ====== Rendering - Card-based Layout ======

    sortAndDisplayImages() {
        this.accordion.innerHTML = "";

        const customDirsToDisplay = this.isSearchActive ? this.filteredCustomDirs : this.allCustomDirs;
        const presetsToDisplay = this.isSearchActive ? this.filteredPresets : this.allPresets;

        // Check if we're in image view mode (showing expanded category)
        if (this.currentView.mode === 'images') {
            this.renderExpandedImages();
            return;
        }

        // Categories view - show card grid
        const totalDirs = customDirsToDisplay.filter(d => d.items.length > 0).length;
        const totalPresets = presetsToDisplay.length;

        if (totalDirs === 0 && totalPresets === 0 && !this.isSearchActive) {
            this.displayNoFilesMessage();
            return;
        }

        if (totalDirs === 0 && totalPresets === 0 && this.isSearchActive) {
            this.accordion.appendChild($el("div", {
                className: "neo-gallery-no-files"
            }, [
                $el("div", { className: "neo-gallery-no-files-icon", textContent: "\uD83D\uDE14" }),
                $el("div", { className: "neo-gallery-no-files-text", textContent: "No matching images found" })
            ]));
            return;
        }

        // Render category cards (custom dirs + presets)
        const cardContainer = this.createCategoryCardGrid(customDirsToDisplay, presetsToDisplay);
        if (cardContainer) {
            this.accordion.appendChild(cardContainer);
        }
    }

    createCategoryCardGrid(dirGroups, presetItems) {
        // Group presets by category
        const presetGroups = new Map();
        presetItems.forEach(item => {
            const cat = item.category || "";
            if (!presetGroups.has(cat)) presetGroups.set(cat, []);
            presetGroups.get(cat).push(item);
        });

        const container = $el("div", { className: "neo-gallery-category-grid" });

        // Add custom dir cards - use hierarchical navigation
        for (const dir of dirGroups) {
            if (dir.items.length === 0) continue;
            const card = this.createDirCard(dir.name, dir.path, dir.items);
            container.appendChild(card);
        }

        // Add preset category cards - also use hierarchical navigation
        const allCategories = [...presetGroups.keys()].sort((a, b) => {
            if (!a) return -1;
            if (!b) return 1;
            return a.localeCompare(b);
        });

        for (const cat of allCategories) {
            const groupItems = presetGroups.get(cat);
            const title = cat ? `Presets/${cat}` : "Presets";
            const card = this.createPresetCategoryCard(title, groupItems);
            container.appendChild(card);
        }

        return container;
    }

    createDirCard(name, path, items) {
        // Get first image as cover
        const coverImage = items.find(i => /\.(png|jpg|jpeg|gif|webp)$/i.test(i.filename));
        
        const card = $el("div", {
            className: "neo-gallery-category-card",
            onclick: () => this.showDirectoryStructure(name, [])
        });

        // Cover image area
        const coverWrapper = $el("div", { className: "neo-gallery-card-cover-wrapper" });
        if (coverImage) {
            const categoryParam = coverImage.category ? `&category=${encodeURIComponent(coverImage.category)}` : '';
            const src = `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(coverImage.filename)}&subfolder=${encodeURIComponent(name)}${categoryParam}`;
            
            const img = $el("img", {
                className: "neo-gallery-card-cover",
                src: src,
                alt: name,
                loading: "lazy"
            });
            
            // Set a default height while image loads; will adjust after load
            coverWrapper.style.height = '120px';
            
            img.onload = () => {
                const aspectRatio = img.naturalHeight / img.naturalWidth;
                const cardWidth = coverWrapper.clientWidth || 160;
                const imgHeight = Math.max(cardWidth * aspectRatio, 80);
                coverWrapper.style.height = `${imgHeight}px`;
            };
            
            coverWrapper.appendChild(img);
        } else {
            coverWrapper.appendChild($el("div", {
                className: "neo-gallery-card-cover neo-gallery-card-placeholder",
                textContent: "\uD83D\uDCC1"
            }));
        }

        // Card info (name + count)
        const info = $el("div", { className: "neo-gallery-card-info" }, [
            $el("span", { className: "neo-gallery-card-name", textContent: name }),
            $el("span", { className: "neo-gallery-card-count", textContent: `${items.length} items` })
        ]);

        // Type indicator badge (top-left corner) — 📁 for directory, 🖼️ for image preset
        const typeBadge = $el("div", {
            className: "neo-gallery-card-type-badge type-directory",
            title: "Directory"
        }, ["\uD83D\uDCC1"]);

        // Delete button (top-right on hover)
        const deleteBtn = $el("div", {
            className: "neo-gallery-card-delete-btn",
            title: `Remove directory "${name}"`,
            onclick: (e) => {
                e.stopPropagation();
                this.removeCustomDir(path);
            }
        }, ["\u00D7"]);

        card.appendChild(typeBadge);
        card.appendChild(coverWrapper);
        card.appendChild(info);
        card.appendChild(deleteBtn);

        return card;
    }

    createPresetCategoryCard(title, items) {
        // Get first image as cover
        const coverImage = items.find(i => /\.(png|jpg|jpeg|gif|webp)$/i.test(i.filename));
        
        // Extract the raw category from display title: "Presets/Anime" -> "Anime", "Presets" -> ""
        let rawCategory = '';
        const slashIdx = title.indexOf('/');
        if (slashIdx > 0) {
            rawCategory = title.substring(slashIdx + 1).trim();
        }
        
        const card = $el("div", {
            className: "neo-gallery-category-card",
            onclick: () => this.showPresetCategory(rawCategory, title)
        });

        // Cover image area
        const presetCoverWrapper = $el("div", { className: "neo-gallery-card-cover-wrapper" });
        if (coverImage) {
            const categoryParam = coverImage.category ? `&category=${encodeURIComponent(coverImage.category)}` : '';
            const src = coverImage.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(coverImage.filename)}&subfolder=presets${categoryParam}`;
            
            const img = $el("img", {
                className: "neo-gallery-card-cover",
                src: src,
                alt: title,
                loading: "lazy"
            });
            
            // Set a default height while image loads; will adjust after load
            presetCoverWrapper.style.height = '120px';
            
            img.onload = () => {
                const aspectRatio = img.naturalHeight / img.naturalWidth;
                const cardWidth = presetCoverWrapper.clientWidth || 160;
                const imgHeight = Math.max(cardWidth * aspectRatio, 80);
                presetCoverWrapper.style.height = `${imgHeight}px`;
            };
            
            presetCoverWrapper.appendChild(img);
        } else {
            presetCoverWrapper.appendChild($el("div", {
                className: "neo-gallery-card-cover neo-gallery-card-placeholder",
                textContent: "\uD83C\uDFA8"
            }));
        }

        // Type indicator badge (top-left corner) — 📁 for directory, 🖼️ for image preset
        const typeBadge = $el("div", {
            className: "neo-gallery-card-type-badge type-image",
            title: "Preset Category"
        }, ["\uD83D\uDDBC\uFE0F"]);

        // Card info (name + count)
        const info = $el("div", { className: "neo-gallery-card-info" }, [
            $el("span", { className: "neo-gallery-card-name", textContent: title }),
            $el("span", { className: "neo-gallery-card-count", textContent: `${items.length} items` })
        ]);

        card.appendChild(typeBadge);
        card.appendChild(presetCoverWrapper);
        card.appendChild(info);
        return card;
    }

    showPresetCategory(rawCategory, displayTitle) {
        this.currentView.mode = 'images';
        this.currentView.source = 'presets';
        // Store raw category for filtering in renderExpandedImages
        this._presetRawCategory = rawCategory;
        this._presetDisplayTitle = displayTitle;
        
        // Update breadcrumb with the display title
        const breadcrumb = document.getElementById("neo-gallery-breadcrumb");
        if (breadcrumb) {
            breadcrumb.style.display = 'flex';
            breadcrumb.innerHTML = '';
            
            // Home button
            const homeBtn = $el("span", {
                className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-home",
                textContent: "\uD83C\uDFE0",
                onclick: (e) => { e.stopPropagation(); this.showCategoryCards(); }
            });
            breadcrumb.appendChild(homeBtn);
            
            // Separator and display title
            const sep = $el("span", { className: "neo-gallery-breadcrumb-sep", textContent: ">" });
            breadcrumb.appendChild(sep);
            breadcrumb.appendChild($el("span", {
                className: "neo-gallery-breadcrumb-item neo-gallery-breadcrumb-current",
                textContent: displayTitle
            }));
        }

        this.sortAndDisplayImages();
    }

    async showDirectoryStructure(source, pathSegments = []) {
        // Fetch directory structure from backend API
        const dirName = source;
        const relPath = pathSegments.join("/");
        
        try {
            const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(dirName)}&path=${encodeURIComponent(relPath)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            
            const structure = await resp.json();
            
            // Update current view state
            this.currentView.mode = 'directory';  // New mode for hierarchical navigation
            this.currentView.source = dirName;
            this.currentView.categoryPath = pathSegments;
            this._currentDirStructure = structure;
            
            // Update breadcrumb - pass empty string to avoid redundancy with rootDirName
            this.updateBreadcrumb(pathSegments, '');
            
            // Render directory cards or images based on structure
            this.renderDirectoryStructure(structure, dirName, pathSegments);
        } catch (error) {
            console.error('[Gallery] Error loading directory structure:', error);
            this.showToast('error', 'Error', 'Failed to load directory structure');
        }
    }

    renderDirectoryStructure(structure, dirName, pathSegments) {
        this.accordion.innerHTML = "";
        
        const { subdirs, images, has_subdirs, image_count, total_images } = structure;
        
        // If there are subdirectories, show them as cards (hierarchical navigation)
        if (has_subdirs && subdirs.length > 0) {
            this.renderSubdirCards(structure, dirName, pathSegments);
        } else {
            // No more subdirs - show images with pagination
            this.renderImagesFromStructure(images, dirName, pathSegments);
        }
    }

    renderSubdirCards(structure, dirName, pathSegments) {
        const { subdirs, images, image_count, total_images } = structure;
        
        // Show summary info
        const summaryEl = $el("div", {
            className: "neo-gallery-dir-summary",
            textContent: `${total_images} items in ${subdirs.length} folders`
        });
        this.accordion.appendChild(summaryEl);
        
        // Create card grid for subdirectories (always first)
        const container = $el("div", { className: "neo-gallery-category-grid" });
        
        for (const subdir of subdirs) {
            const card = this.createSubdirCard(subdir, dirName, [...pathSegments, subdir]);
            container.appendChild(card);
        }
        
        // Append subdirectory cards first
        if (subdirs.length > 0) {
            this.accordion.appendChild(container);
        }
        
        // If there are also images at root level, show them below the subdirectories
        if (image_count > 0) {
            const separator = $el("div", {
                className: "neo-gallery-section-separator",
                textContent: `Files in this folder (${image_count})`
            });
            this.accordion.appendChild(separator);
            
            // Show root-level images as thumbnails (not cards)
            const imageGrid = $el("div", { className: "neo-gallery-image-grid" });
            
            // Build clean subfolder path for this level
            let currentSubfolder;
            if (pathSegments.length > 0) {
                currentSubfolder = dirName + "/" + pathSegments.join("/");
            } else {
                currentSubfolder = dirName;
            }
            
            for (let i = 0; i < Math.min(20, images.length); i++) {
                const imgEl = this.createImageElement(images[i], currentSubfolder);
                imageGrid.appendChild(imgEl);
            }
            this.accordion.appendChild(imageGrid);
            
            if (image_count > 20) {
                const loadMoreBtn = $el("div", {
                    className: "neo-gallery-load-more-btn",
                    textContent: `Load more (${image_count - 20} remaining)`
                });
                loadMoreBtn.onclick = () => {
                    this.renderImagesFromStructure(images, dirName, pathSegments);
                    loadMoreBtn.remove();
                };
                this.accordion.appendChild(loadMoreBtn);
            }
        }
    }

    createSubdirCard(subdirName, parentDir, fullPath) {
        const card = $el("div", {
            className: "neo-gallery-category-card",
            onclick: () => this.showDirectoryStructure(parentDir, fullPath)
        });

        // Type indicator badge (top-left corner) — will update after async fetch
        const typeBadge = $el("div", {
            className: "neo-gallery-card-type-badge neo-gallery-card-type-loading",
            title: "Loading..."
        }, ["\uD83D\uDCC1"]);

        // Cover image area (will be updated with actual cover after async fetch)
        const coverWrapper = $el("div", { 
            className: "neo-gallery-card-cover-wrapper",
            style: { minHeight: '80px' }
        });
        
        // Show placeholder while loading
        coverWrapper.appendChild($el("div", {
            className: "neo-gallery-card-cover neo-gallery-card-placeholder",
            textContent: "\uD83D\uDCC1"
        }));

        // Card info (name + count)
        const info = $el("div", { className: "neo-gallery-card-info" }, [
            $el("span", { className: "neo-gallery-card-name", textContent: subdirName }),
            $el("span", { className: "neo-gallery-card-count", textContent: "Loading..." })
        ]);

        card.appendChild(typeBadge);
        card.appendChild(coverWrapper);
        card.appendChild(info);

        // Fetch directory structure asynchronously to get cover image and count
        setTimeout(async () => {
            try {
                const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(parentDir)}&path=${encodeURIComponent(fullPath.join("/"))}`);
                if (!resp.ok) throw new Error('Failed to fetch');
                
                const structure = await resp.json();
                const countEl = card.querySelector('.neo-gallery-card-count');
                const typeBadge = card.querySelector('.neo-gallery-card-type-badge');
                
                // Update count
                if (countEl) {
                    countEl.textContent = `${structure.total_images} items`;
                }

                // Update type badge based on content type
                if (typeBadge) {
                    if (structure.images && structure.images.length > 0) {
                        typeBadge.className = 'neo-gallery-card-type-badge neo-gallery-card-type-loading type-image';
                        typeBadge.title = 'Preset Category';
                        typeBadge.textContent = '\uD83D\uDDBC\uFE0F';
                    } else if (structure.subdirs && structure.subdirs.length > 0) {
                        typeBadge.className = 'neo-gallery-card-type-badge neo-gallery-card-type-loading type-directory';
                        typeBadge.title = 'Directory';
                        typeBadge.textContent = '\uD83D\uDCC1';
                    }
                }

                // If there are images, use the first one as cover
                if (structure.images && structure.images.length > 0) {
                    const firstImage = structure.images[0];
                    const categoryParam = firstImage.category ? `&category=${encodeURIComponent(firstImage.category)}` : '';
                    let currentSubfolder;
                    if (fullPath.length > 0) {
                        currentSubfolder = parentDir + "/" + fullPath.join("/");
                    } else {
                        currentSubfolder = parentDir;
                    }
                    
                    const coverSrc = `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(firstImage.filename)}&subfolder=${encodeURIComponent(currentSubfolder)}${categoryParam}`;
                    
                    // Replace placeholder with actual image
                    coverWrapper.innerHTML = '';
                    const img = $el("img", {
                        className: "neo-gallery-card-cover",
                        src: coverSrc,
                        alt: subdirName,
                        loading: "lazy"
                    });
                    
                    img.onload = () => {
                        const aspectRatio = img.naturalHeight / img.naturalWidth;
                        const cardWidth = coverWrapper.clientWidth || 160;
                        const imgHeight = Math.max(cardWidth * aspectRatio, 80);
                        coverWrapper.style.height = `${imgHeight}px`;
                    };
                    
                    // Fallback if image load fails
                    img.onerror = () => {
                        coverWrapper.innerHTML = '';
                        coverWrapper.appendChild($el("div", {
                            className: "neo-gallery-card-cover neo-gallery-card-placeholder",
                            textContent: "\uD83D\uDCC1"
                        }));
                    };
                    
                    coverWrapper.appendChild(img);
                } else if (structure.subdirs && structure.subdirs.length > 0) {
                    // If no images but has subdirs, show a nested folder icon
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

    renderImagesFromStructure(images, dirName, pathSegments) {
        // Build clean subfolder path without trailing slash
        let subfolder;
        if (pathSegments.length > 0) {
            subfolder = dirName + "/" + pathSegments.join("/");
        } else {
            subfolder = dirName;
        }
        
        if (images.length === 0) {
            this.accordion.appendChild($el("div", {
                className: "neo-gallery-no-files"
            }, [
                $el("div", { className: "neo-gallery-no-files-icon", textContent: "\uD83D\uDE14" }),
                $el("div", { className: "neo-gallery-no-files-text", textContent: "No images found in this folder" })
            ]));
            return;
        }

        // Sort by mtime descending (newest first), fallback to name sort
        const sortedItems = [...images].sort((a, b) => {
            if ((b._mtime || 0) !== (a._mtime || 0)) return (b._mtime || 0) - (a._mtime || 0);
            return a.name.localeCompare(b.name);
        });

        // For large lists, use pagination to avoid freezing the UI
        const PAGE_SIZE = 100;
        let displayedCount = Math.min(PAGE_SIZE, sortedItems.length);
        
        // Image grid for expanded view
        const imageGrid = $el("div", { className: "neo-gallery-image-grid neo-gallery-expanded-images" });
        
        const renderPage = (count) => {
            for (let i = 0; i < count && this._renderQueue.length > 0; i++) {
                const item = this._renderQueue.shift();
                const el = this.createImageElement(item, subfolder);
                if (!/\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i.test(item.filename)) {
                    el.style.width = `${this.maxThumbnailSize}px`;
                }
                imageGrid.appendChild(el);
            }
        };

        // Render first page immediately using requestAnimationFrame to avoid blocking
        this._renderQueue = [...sortedItems];
        
        // Append grid and load more button BEFORE rendering to ensure DOM structure is correct
        this.accordion.appendChild(imageGrid);
        
        renderPage(displayedCount);
        
        if (displayedCount < sortedItems.length) {
            const createLoadMoreBtn = () => {
                const btn = $el("div", {
                    className: "neo-gallery-load-more-btn",
                    textContent: `Load more (${this._renderQueue.length} remaining)`
                });
                btn.onclick = () => {
                    btn.remove();
                    renderPage(PAGE_SIZE);
                    if (this._renderQueue.length > 0) {
                        this.accordion.appendChild(createLoadMoreBtn());
                    }
                };
                return btn;
            };
            this.accordion.appendChild(createLoadMoreBtn());
        }
    }

    showCategoryImages(source, pathSegments, displayName) {
        // Use hierarchical directory structure navigation instead of flat image view
        this.showDirectoryStructure(source, pathSegments || []);
    }

    async showPresetDirectory(rawCategory) {
        // Use hierarchical directory navigation for presets
        const dirName = 'presets';
        
        if (rawCategory && rawCategory !== '') {
            // Navigate into a specific preset category subdirectory
            try {
                const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(dirName)}&path=${encodeURIComponent(rawCategory)}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                
                const structure = await resp.json();
                
                this.currentView.mode = 'directory';
                this.currentView.source = dirName;
                this.currentView.categoryPath = [rawCategory];
                this._currentDirStructure = structure;
                
                // Update breadcrumb
                this.updateBreadcrumb([rawCategory], '');
                
                // Render directory cards or images based on structure
                this.renderDirectoryStructure(structure, dirName, [rawCategory]);
            } catch (error) {
                console.error('[Gallery] Error loading preset directory:', error);
                this.showToast('error', 'Error', 'Failed to load preset category');
            }
        } else {
            // Show presets root level - use dir_structure API
            try {
                const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(dirName)}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                
                const structure = await resp.json();
                
                this.currentView.mode = 'directory';
                this.currentView.source = dirName;
                this.currentView.categoryPath = [];
                this._currentDirStructure = structure;
                
                // Update breadcrumb
                this.updateBreadcrumb([], '');
                
                // Render directory cards or images based on structure
                this.renderDirectoryStructure(structure, dirName, []);
            } catch (error) {
                console.error('[Gallery] Error loading presets:', error);
                this.showToast('error', 'Error', 'Failed to load presets');
            }
        }
    }

    showCategoryCards() {
        this.currentView.mode = 'categories';
        this.currentView.source = null;
        this.currentView.categoryPath = [];
        
        // Hide breadcrumb (show only home)
        const breadcrumb = document.getElementById("neo-gallery-breadcrumb");
        if (breadcrumb) {
            breadcrumb.style.display = 'none';
        }

        this.sortAndDisplayImages();
    }

    renderExpandedImages() {
        const { source, categoryPath } = this.currentView;
        
        // Collect all images from the selected source/category
        let items = [];
        let subfolder = source;

        console.log('[Gallery] renderExpandedImages:', { source, categoryPath, presetRawCat: this._presetRawCategory });
        if (source === 'presets') {
            // Use _presetRawCategory for filtering (set by showPresetCategory)
            const catToMatch = this._presetRawCategory || '';
            console.log('[Gallery] Matching presets with category:', JSON.stringify(catToMatch));
            items = this.allPresets.filter(i => i.category === catToMatch);
            console.log('[Gallery] Found', items.length, 'presets for category');
        } else {
            // Custom directory
            const dir = this.allCustomDirs.find(d => d.name === source);
            if (dir) {
                subfolder = source;
                if (categoryPath.length > 0) {
                    // Filter by category path
                    const catKey = categoryPath[0];
                    items = dir.items.filter(i => i.category === catKey || (!i.category && !catKey));
                } else {
                    items = [...dir.items];
                }
            }
        }

        if (items.length === 0) {
            this.accordion.appendChild($el("div", {
                className: "neo-gallery-no-files"
            }, [
                $el("div", { className: "neo-gallery-no-files-icon", textContent: "\uD83D\uDE14" }),
                $el("div", { className: "neo-gallery-no-files-text", textContent: "No images found in this category" })
            ]));
            return;
        }

        // Sort by mtime descending (newest first), fallback to name sort
        const sortedItems = [...items].sort((a, b) => {
            if ((b._mtime || 0) !== (a._mtime || 0)) return (b._mtime || 0) - (a._mtime || 0);
            return a.name.localeCompare(b.name);
        });

        // For large lists, use pagination to avoid freezing the UI
        const PAGE_SIZE = 100;
        let displayedCount = Math.min(PAGE_SIZE, sortedItems.length);
        
        // Image grid for expanded view
        const imageGrid = $el("div", { className: "neo-gallery-image-grid neo-gallery-expanded-images" });
        
        const renderPage = (count) => {
            for (let i = 0; i < count && this._renderQueue.length > 0; i++) {
                const item = this._renderQueue.shift();
                const el = this.createImageElement(item, subfolder);
                if (!/\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i.test(item.filename)) {
                    el.style.width = `${this.maxThumbnailSize}px`;
                }
                imageGrid.appendChild(el);
            }
        };

        // Render first page immediately using requestAnimationFrame to avoid blocking
        this._renderQueue = [...sortedItems];
        
        // Append grid and load more button BEFORE rendering to ensure DOM structure is correct
        this.accordion.appendChild(imageGrid);
        
        renderPage(displayedCount);
        
        if (displayedCount < sortedItems.length) {
            const createLoadMoreBtn = () => {
                const btn = $el("div", {
                    className: "neo-gallery-load-more-btn",
                    textContent: `Load more (${this._renderQueue.length} remaining)`
                });
                btn.onclick = () => {
                    btn.remove();
                    renderPage(PAGE_SIZE);
                    if (this._renderQueue.length > 0) {
                        this.accordion.appendChild(createLoadMoreBtn());
                    }
                };
                return btn;
            };
            this.accordion.appendChild(createLoadMoreBtn());
        }
    }

    // ====== Image Element Creation ======

    createImageElement(image, subfolder) {
        // Use preview data URI directly if available
        const categoryParam = image.category ? `&category=${encodeURIComponent(image.category)}` : '';
        const src = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}${categoryParam}`;

        // Determine if this is an image file (has aspect ratio) or non-image
        const isImageFile = /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i.test(image.filename);

        // Reserve space for btn bar (~32px) and label (~20px if shown) = ~52px total
        const reservedSpace = this.displayLabels ? 52 : 36;
        const imageHeight = Math.max(this.maxThumbnailSize - reservedSpace, 40);

        // Create container - height is fixed, width will be set based on image aspect ratio
        const container = $el("div", {
            className: "neo-gallery-thumb-container",
            style: {
                height: `${this.maxThumbnailSize}px`,
                width: `${this.maxThumbnailSize}px`
            },
            onclick: () => this.showLightbox(image, subfolder)
        });

        // If it's an image, load it to get aspect ratio for proper width calculation
        if (isImageFile) {
            const img = new Image();
            img.onload = () => {
                const aspectRatio = img.height / img.width;
                container.style.width = `${Math.max(this.maxThumbnailSize * (1 / aspectRatio), 40)}px`;
            };
            img.src = src;
        }

        // Delete button for custom dir items - top-right corner
        let deleteBtn = null;
        if (!['presets'].includes(subfolder)) {
            deleteBtn = $el("div", {
                className: "neo-gallery-delete-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    this.deleteItem(image.name, subfolder);
                }
            }, ["\u00D7"]);
        }

        // Send button — shows dropdown menu for target selection
        const sendBtn = $el("div", {
            className: "neo-gallery-thumb-send-btn",
            onclick: (e) => {
                e.stopPropagation();
                this._showSendMenu(image, sendBtn);
            }
        }, ["\u2708\uFE0F"]);

        // Copy button
        const copyBtn = $el("div", {
            className: "neo-gallery-thumb-copy-btn",
            onclick: (e) => {
                e.stopPropagation();
                this.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
            }
        }, ["\u29C9"]);

        const imgEl = $el("img", {
            className: "neo-gallery-thumb-img",
            src: src,
            alt: image.name,
            onerror: () => {
                if (!image.preview) imgEl.src = this.placeholderImageUrl;
            }
        });

        // Buttons overlay at bottom of the image (floating above image edge)
        const btnBar = $el("div", {
            className: "neo-gallery-thumb-btn-bar"
        }, [sendBtn, copyBtn]);

        // Wrap image and floating buttons together
        const imgWrapper = $el("div", {
            className: "neo-gallery-thumb-img-wrapper"
        }, [imgEl, btnBar]);

        const labelEl = this.displayLabels ? $el("span", {
            className: "neo-gallery-image-label",
            textContent: image.name.replace(/\.\w+$/, '') // strip extension
        }) : null;

        if (deleteBtn) container.appendChild(deleteBtn);
        container.appendChild(imgWrapper);
        if (labelEl) container.appendChild(labelEl);

        // Tooltip shows filename title on hover
        container.title = image.name.replace(/\.\w+$/, '');

        return container;
    }

    // ====== Prompt Handling ======

    cleanText(text) {
        if (!text) return "";
        text = text.replace(/^[,\s]+|[,\s]+$/g, '');
        text = text.replace(/\s*BREAK\s*(?:,\s*)?/gi, '. ');
        text = text.replace(/\.{2,}/g, '.').replace(/,\s*\./g, '.');
        text = text.replace(/([.,])(?=\S)/g, '$1 ').trim();
        return text;
    }

    getFirstSegment(text) {
        if (!text) return "";
        const segments = text.split(/[.\u3002\uFF01\uFF01\uff1b:\n]+/).filter(s => s.trim());
        if (segments.length === 0) return "";
        let first = segments[0].trim();
        const colonIdx = first.indexOf('\uff1a');
        if (colonIdx > 0) {
            first = first.substring(colonIdx + 1).trim();
        }
        return first.length > 50 ? first.substring(0, 50) + '...' : first;
    }

    parsePromptSections(txtContent) {
        if (!txtContent) return [];
        const rawSegments = txtContent.split(/[.\u3002\uff01\uff01\uff1b\n]+/).filter(s => s.trim());
        const sections = [];

        for (const rawSeg of rawSegments) {
            const trimmed = rawSeg.trim();
            if (!trimmed) continue;

            const fullColonMatch = trimmed.match(/^(.+?)[\uff1a](.*)$/s);
            if (fullColonMatch) {
                const beforeColon = fullColonMatch[1].trim();
                const afterColon = fullColonMatch[2].trim();
                const cjkMatch = beforeColon.match(/[\u4e00-\u9fa5]/g);
                const cjkCount = cjkMatch ? cjkMatch.length : 0;

                if (cjkCount > 0 && cjkCount <= 10 && beforeColon.length <= 30) {
                    sections.push({ label: beforeColon, value: afterColon });
                } else {
                    sections.push({ label: null, value: trimmed });
                }
                continue;
            }

            sections.push({ label: null, value: trimmed });
        }

        return sections;
    }

    combineTexts(existing, newText) {
        existing = this.cleanText(existing);
        newText = this.cleanText(newText);
        if (!existing) return newText;
        return existing.endsWith('.') ? existing + ' ' + newText : existing + ', ' + newText;
    }

    generateRandomPrompt() {
        const allItems = [...this.allPresets];
        // Also include items from custom dirs for random prompt
        for (const dir of this.allCustomDirs) {
            allItems.push(...dir.items.map(i => ({...i, subfolder: dir.name})));
        }
        
        if (allItems.length === 0) {
            this.showToast('warning', 'No Presets', 'No presets available.');
            return;
        }
        const randomItem = allItems[Math.floor(Math.random() * allItems.length)];
        if (randomItem && randomItem.txt_content) {
            this.copyToClipboard("Random Prompt", randomItem.txt_content);
        } else {
            this.showToast('error', 'No Prompt', 'No txt data in selected preset.');
        }
    }

    copyToClipboard(imageName, txtContent, feedbackBtn = null, actionType = 'send') {
        let textToCopy = String(txtContent || "").trim();
        textToCopy = this.cleanText(textToCopy);

        const selectedValue = document.getElementById("target-node-dropdown")?.value;

        let targetNodeIds = [];
        let isPromptNode = false;
        let targetNode = null;
        let targetWidget = null;

        if (selectedValue === "selected") {
            const selectedKeys = Object.keys(app.canvas.selected_nodes);
            if (selectedKeys.length > 0) {
                targetNode = app.canvas.selected_nodes[selectedKeys[0]];
                if (targetNode && targetNode._rsPromptUIElements) {
                    isPromptNode = true;
                    targetNodeIds.push(parseInt(selectedKeys[0]));
                }
                if (!isPromptNode && targetNode) {
                    targetWidget = targetNode.widgets?.find(w => ['string', 'text', 'customtext'].includes(w.type));
                }
            }
        } else if (selectedValue) {
            const [nodeId, , index] = selectedValue.split(':');
            targetNode = app.graph.getNodeById(parseInt(nodeId));
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
            app.graph.setDirtyCanvas(true, true);
            if (feedbackBtn) {
                this.showInlineFeedback(feedbackBtn, '\u2705 Sent!', 'success');
            } else {
                this.showToast('success', 'Tags Sent!', `Sent to ${targetNode.title || 'Node'}`);
            }
        } else if (targetNode && targetWidget) {
            targetWidget.value = textToCopy;
            if (targetNode.onWidgetChanged) targetNode.onWidgetChanged(targetWidget.name, targetWidget.value);
            app.graph.setDirtyCanvas(true, true);
            if (feedbackBtn) {
                this.showInlineFeedback(feedbackBtn, '\u2705 Sent!', 'success');
            } else {
                this.showToast('success', 'Tags Sent!', `Sent to ${targetNode.title} - ${targetWidget.name}`);
            }
        } else {
            navigator.clipboard.writeText(textToCopy).then(() => {
                if (feedbackBtn) {
                    const msg = actionType === 'send' ? '\u2705 Sent!' : '\u2705 Copied!';
                    this.showInlineFeedback(feedbackBtn, msg, 'success');
                } else {
                    this.showToast('success', actionType === 'send' ? 'Tags Sent!' : 'Tags Copied!', `Tags for "${imageName}" ${actionType === 'send' ? 'sent to' : 'copied to'} clipboard`);
                }
            }).catch(() => {
                if (feedbackBtn) {
                    this.showInlineFeedback(feedbackBtn, '\u274C Failed', 'error');
                } else {
                    this.showToast('error', actionType === 'send' ? 'Send Failed' : 'Copy Failed', `Failed to ${actionType === 'send' ? 'send' : 'copy'} tags`);
                }
            });
        }
    }

    // ====== Utility ======

    debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    showToast(severity, summary, detail) {
        app.extensionManager.toast.add({ severity, summary, detail, life: 5000 });
    }

    showInlineFeedback(button, message, type) {
        const existing = button.querySelector('.neo-gallery-feedback');
        if (existing) existing.remove();

        const feedbackClassName = type === 'success' ? 'neo-gallery-feedback neo-gallery-feedback-success' : 'neo-gallery-feedback neo-gallery-feedback-error';
        const feedback = $el("div", {
            className: feedbackClassName,
            textContent: message
        });

        document.body.appendChild(feedback);

        const buttonRect = button.getBoundingClientRect();
        const top = buttonRect.top;
        const left = buttonRect.left + buttonRect.width / 2;

        feedback.style.position = 'fixed';
        feedback.style.top = (top - 32) + 'px';
        feedback.style.left = left + 'px';
        feedback.style.transform = 'translateX(-50%)';
        feedback.style.zIndex = '2147483646';
        feedback.style.pointerEvents = 'none';

        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.style.opacity = "0";
                feedback.style.transition = "opacity 0.3s ease";
                setTimeout(() => {
                    if (feedback.parentNode) feedback.remove();
                }, 300);
            }
        }, 1500);
    }

    displayNoFilesMessage() {
        this.accordion.appendChild($el("div", {
            className: "neo-gallery-no-files-message"
        }, [
            $el("div", { className: "neo-gallery-no-files-message-icon", textContent: "\uD83D\uDCF7" }),
            $el("p", { className: "neo-gallery-no-files-message-text", textContent: "No presets found. Add images + .txt files to gallery/presets/ or click \u{1F4C1} to add custom directories." })
        ]));
    }

    // ====== Lightbox (Large Image Viewer) ======

    injectAnimations() {}

    showLightbox(image, subfolder) {
        this.injectAnimations();

        const existingLightbox = document.querySelector('.neo-gallery-lightbox');
        if (existingLightbox && this.currentLightboxImages && this.currentLightboxImages.length > 0) {
            const newIndex = this.currentLightboxImages.findIndex(img => img.filename === image.filename && img.subfolder === subfolder);
            if (newIndex >= 0) {
                this.updateLightboxContent(existingLightbox, image, subfolder, this.currentLightboxImages, newIndex);
                return;
            }
        }

        const existing = document.querySelector('.neo-gallery-lightbox');
        if (existing) {
            existing.remove();
        }

        const lightbox = $el("div", {
            id: "neo-gallery-lightbox",
            className: "neo-gallery-lightbox",
            onclick: (e) => {
                if (e.target === lightbox) {
                    this.closeLightbox();
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
                this.closeLightbox();
            }
        }, ["\u00D7"]);

        const navBtns = $el("div", {
            className: "neo-gallery-lightbox-nav-btns"
        });

        const sendBtn = $el("div", {
            className: "neo-gallery-lightbox-btn neo-gallery-lightbox-send-btn",
            onclick: (e) => {
                e.stopPropagation();
                this._showSendMenu(image, sendBtn);
            }
        }, ["\u2708\uFE0F Send"]);

        const copyBtn = $el("div", {
            className: "neo-gallery-lightbox-btn neo-gallery-lightbox-copy-btn",
            onclick: (e) => {
                e.stopPropagation();
                this.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
            }
        }, ["\u29C9 Copy"]);

        imgWrapper.appendChild(img);

        // Image info (dimensions) — displayed below the image, not overlapping
        const imageInfo = $el("div", {
            className: "neo-gallery-lightbox-image-info"
        });
        img.onload = () => {
            if (imageInfo) {
                imageInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
            }
        };
        // Append imageInfo inside imgWrapper so it stacks vertically below the image
        imgWrapper.appendChild(imageInfo);

        // Build all images list for navigation based on current view context
        const allImages = [];
        const { source, categoryPath, mode } = this.currentView;
        
        if (source === 'presets') {
            // In presets view - only include preset items in the same category
            const catToMatch = this._presetRawCategory || '';
            const presetItems = this.isSearchActive ? this.filteredPresets : this.allPresets;
            for (const p of presetItems) {
                if (p.category === catToMatch) {
                    allImages.push({...p, subfolder: "presets"});
                }
            }
        } else if (source && mode !== 'categories') {
            // In a custom directory view - only include items from that source
            const dir = this.allCustomDirs.find(d => d.name === source);
            if (dir) {
                let dirItems = [...dir.items];
                
                // If we're in a subdirectory, filter by category path
                if (categoryPath && categoryPath.length > 0) {
                    const catKey = categoryPath[0];
                    dirItems = dirItems.filter(i => i.category === catKey || (!i.category && !catKey));
                }
                
                for (const item of dirItems) {
                    allImages.push({...item, subfolder: source});
                }
            }
        } else {
            // In categories view - include all items from all sources
            for (const dir of this.allCustomDirs) {
                if (!this.isSearchActive || this.filteredCustomDirs.some(d => d.name === dir.name)) {
                    for (const item of dir.items) {
                        allImages.push({...item, subfolder: dir.name});
                    }
                }
            }
            
            const presetItems = this.isSearchActive ? this.filteredPresets : this.allPresets;
            for (const p of presetItems) {
                allImages.push({...p, subfolder: "presets"});
            }
        }
        
        // Sort by name to maintain consistent order with thumbnails
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
                this.updateLightboxContent(lightbox, prevItem, prevItem.subfolder, allImages, currentIndex - 1);
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
                this.updateLightboxContent(lightbox, nextItem, nextItem.subfolder, allImages, currentIndex + 1);
            }
        }, ["\u203A"]);
        imgWrapper.appendChild(nextBtn);

        let promptSection = null;
        if (image.txt_content) {
            promptSection = $el("div", {
                id: "neo-gallery-lightbox-prompt-section",
                className: "neo-gallery-lightbox-prompt-section"
            });

            const sections = this.parsePromptSections(image.txt_content);
            const promptContainer = $el("div", {
                className: "neo-gallery-lightbox-prompt-container"
            });

            if (sections.length > 0 && sections.some(s => s.label)) {
                for (const section of sections) {
                    if (section.label) {
                        const sectionEl = $el("div", {
                            className: "neo-gallery-lightbox-prompt-section-item"
                        }, [
                            $el("span", {
                                className: "neo-gallery-lightbox-prompt-label",
                                textContent: section.label + "\uff1a"
                            }),
                            $el("span", {
                                className: "neo-gallery-lightbox-prompt-value",
                                textContent: section.value
                            })
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
                    textContent: this.cleanText(image.txt_content),
                    style: { whiteSpace: "pre-wrap" }
                }));
            }

            promptSection.appendChild(promptContainer);
            
            const promptBtnsContainer = $el("div", {
                className: "neo-gallery-lightbox-prompt-btns"
            });
            promptBtnsContainer.appendChild(sendBtn);
            promptBtnsContainer.appendChild(copyBtn);
            promptSection.appendChild(promptBtnsContainer);
        }

        // Append elements: imgWrapper first (already contains imageInfo), then promptSection
        container.appendChild(imgWrapper);
        if (promptSection) container.appendChild(promptSection);
        container.appendChild(closeBtn);
        lightbox.appendChild(container);
        document.body.appendChild(lightbox);

        this.currentLightbox = lightbox;
        this.currentLightboxImages = allImages;
        this.currentLightboxIndex = currentIndex;

        const handleKeyDown = (e) => {
            switch (e.key) {
                case 'ArrowLeft':
                    this.navigateLightboxImage(-1);
                    break;
                case 'ArrowRight':
                    this.navigateLightboxImage(1);
                    break;
                case 'Escape':
                    this.closeLightbox();
                    break;
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        this.currentLightboxKeyboardHandler = handleKeyDown;
    }

    closeLightbox() {
        if (this.currentLightbox) {
            this.currentLightbox.remove();
            this.currentLightbox = null;
        }
        if (this.currentLightboxKeyboardHandler) {
            document.removeEventListener('keydown', this.currentLightboxKeyboardHandler);
            this.currentLightboxKeyboardHandler = null;
        }
    }

    navigateLightboxImage(direction) {
        if (!this.currentLightbox || !this.currentLightboxImages || this.currentLightboxImages.length === 0) return;
        
        const newIndex = this.currentLightboxIndex + direction;
        if (newIndex < 0 || newIndex >= this.currentLightboxImages.length) return;
        
        const nextItem = this.currentLightboxImages[newIndex];
        this.updateLightboxContent(this.currentLightbox, nextItem, nextItem.subfolder, this.currentLightboxImages, newIndex);
    }

    updateLightboxContent(lightbox, image, subfolder, allImages, currentIndex) {
        const container = lightbox.querySelector('#neo-gallery-lightbox-container');
        if (!container) {
            this.closeLightbox();
            setTimeout(() => this.showLightbox(image, subfolder), 100);
            return;
        }

        const imgWrapper = container.querySelector('#neo-gallery-lightbox-img-wrapper');
        if (!imgWrapper) {
            this.closeLightbox();
            setTimeout(() => this.showLightbox(image, subfolder), 100);
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
                    
                    // Update image info overlay with dimensions
                    const infoEl = container.querySelector('.neo-gallery-lightbox-image-info');
                    if (infoEl) {
                        infoEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
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
            
            const sections = this.parsePromptSections(image.txt_content);
            const promptContainer = $el("div", {
                className: "neo-gallery-lightbox-prompt-container"
            });

            if (sections.length > 0 && sections.some(s => s.label)) {
                for (const section of sections) {
                    if (section.label) {
                        const sectionEl = $el("div", {
                            className: "neo-gallery-lightbox-prompt-section-item"
                        }, [
                            $el("span", {
                                className: "neo-gallery-lightbox-prompt-label",
                                textContent: section.label + "\uff1a"
                            }),
                            $el("span", {
                                className: "neo-gallery-lightbox-prompt-value",
                                textContent: section.value
                            })
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
                    textContent: this.cleanText(image.txt_content),
                    style: { whiteSpace: "pre-wrap" }
                }));
            }

            promptSection.appendChild(promptContainer);
            
            let promptBtnsContainer = promptSection.querySelector('.neo-gallery-lightbox-prompt-btns');
            if (!promptBtnsContainer) {
                promptBtnsContainer = $el("div", {
                    className: "neo-gallery-lightbox-prompt-btns"
                });
                
                const sendBtn = $el("div", {
                    className: "neo-gallery-lightbox-btn neo-gallery-lightbox-send-btn",
                    onclick: (e) => {
                        e.stopPropagation();
                        app.neoGallery._showSendMenu(image, sendBtn);
                    }
                }, ["\u2708\uFE0F Send"]);
                
                const copyBtn = $el("div", {
                    className: "neo-gallery-lightbox-btn neo-gallery-lightbox-copy-btn",
                    onclick: (e) => {
                        e.stopPropagation();
                        app.neoGallery.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
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
                    this.updateLightboxContent(lightbox, prevItem, prevItem.subfolder, allImages, currentIndex - 1);
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
                    this.updateLightboxContent(lightbox, nextItem, nextItem.subfolder, allImages, currentIndex + 1);
                };
            } else {
                nextBtn.onclick = null;
            }
        }

        this.currentLightboxIndex = currentIndex;
    }

    // ====== Main init ======

    async init() {
        await this.loadPluginData();
    }

    async loadAndDisplay() {
        // Show loading state immediately in accordion
        this.accordion.innerHTML = '';
        const loadingEl = $el("div", { className: "neo-gallery-loading-overlay" }, [
            $el("div", { className: "neo-gallery-loading-spinner" }),
            $el("span", { className: "neo-gallery-loading-text", textContent: "Loading gallery..." })
        ]);
        this.accordion.appendChild(loadingEl);

        // Force DOM update before async operation
        await Promise.resolve();
        
        await this.loadGallery();
        
        // Remove loading state and display content
        if (loadingEl.parentNode) loadingEl.remove();
        this.sortAndDisplayImages();
    }
}

// ====== Extension Registration =====
app.registerExtension({
    name: "comfy.neo.gallery",
    async setup() {
        const gallery = new NeoGallery(app);
        app.neoGallery = gallery;
        await gallery.init();

        // Settings
        app.ui.settings.addSetting({
            id: "Neo Gallery._General.maxThumbnailSize",
            name: "Neo Gallery Max Thumbnail Size",
            type: "slider", attrs: { min: 150, max: 500, step: 25 }, defaultValue: 300,
            onChange: (val) => { if (app.neoGallery) app.neoGallery.updateThumbnailSize(val); }
        });

        app.ui.settings.addSetting({
            id: "Neo Gallery._General.displayLabels",
            name: "Neo Gallery Display Image Labels",
            type: "boolean", defaultValue: true,
            onChange: (val) => { if (app.neoGallery) app.neoGallery.updateLabelDisplay(val); }
        });

        if (app.extensionManager && app.extensionManager.registerSidebarTab) {
                app.extensionManager.registerSidebarTab({
            id: "neo.gallery",
            icon: "pi pi-images",
            title: "画廊",
            tooltip: "Neo Gallery",
            type: "custom",
            render: async (el) => {
                // Clear any other content from previous renders first
                el.innerHTML = "";
                
                // Always append to ensure it's in the current container
                if (gallery.element.parentNode) {
                    gallery.element.parentNode.removeChild(gallery.element);
                }
                el.appendChild(gallery.element);
                
                // Load gallery data only when sidebar tab is opened
                if (!gallery._loaded) {
                    await gallery.loadAndDisplay();
                    gallery._loaded = true;
                } else {
                    // Use cached data — just re-render without API call
                    gallery.accordion.innerHTML = "";
                    gallery.sortAndDisplayImages();
                }
            },
            });
        }
    },
});
