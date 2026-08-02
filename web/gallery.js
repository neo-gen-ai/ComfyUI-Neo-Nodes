import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { $el } from "../../../../scripts/ui.js";
import { GalleryComponents } from './gallery-components.js';
import {
    PAGE_SIZE,
    getReservedSpace,
    isImageFile,
    sortByMtime,
    showNoFilesMessage,
    showLoadingOverlay,
    showToast,
    showInlineFeedback
} from './gallery-utils.js';

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
        this.allCustomDirs = [];
        this.allPresets = [];
        this.filteredCustomDirs = [];
        this.filteredPresets = [];
        this.sortAscending = true;
        this._renderQueue = [];
        this._renderedCount = 0;
        
        // UI components
        this.components = new GalleryComponents(this);
        this.searchInput = this.components.createSearchInput(this);
        this.thumbnailSizeSlider = this.components.createThumbnailSizeSlider(this);
        this.customDirSettingBtn = null;
        
        // Card-based layout state
        this.currentView = {
            mode: 'categories',
            source: null,
            categoryPath: [],
        };
        this.placeholderImageUrl = `${window.location.protocol}//${window.location.host}/neo_gallery/placeholder.png`;
        this.sectionStates = {};
        this.isSearchActive = false;
        this.elementId = "neo-gallery-panel-root";
        
        // Custom dir input
        this.customDirInput = $el("input", {
            type: "text",
            value: "",
            readonly: true,
            className: "neo-gallery-custom-dir-input-inline",
            style: { display: "none" }
        });

        const customDirBtn = this.components.createCustomDirSettingBtn(this);

        // Create target node dropdown and use selected node checkbox
        this.targetNodeDropdown = this.components.createTargetNodeDropdown(this);
        this.useSelectedNodeCheckbox = this.components.createUseSelectedNodeCheckbox(this);

        // Main content area
        this.accordion = $el("div", { className: "neo-gallery-accordion" });

        this.element = $el("div", { id: this.elementId, className: "neo-gallery-panel" }, [
            $el("div", { 
                className: "neo-gallery-header-row",
                style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center' }
            }, [
                $el("h3", { className: "neo-gallery-header-title", textContent: "Neo Gallery" }),
                $el("div", { 
                    style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, gridColumn: '2' }
                }, [this.thumbnailSizeSlider]),
                $el("div", { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, [customDirBtn])
            ]),
            $el("div", { className: "neo-gallery-search-row" }, [
                $el("div", { className: "neo-gallery-search-container" }, [this.searchInput])
            ]),
            $el("div", { 
                id: "neo-gallery-breadcrumb",
                className: "neo-gallery-breadcrumb",
                style: { display: 'none' }
            }, [this.components.createBreadcrumbHome(this)]),
            // Add target node selection controls
            $el("div", { 
                className: "neo-gallery-target-controls",
                style: { 
                    display: 'flex', 
                    gap: '10px', 
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderBottom: '1px solid #333'
                }
            }, [
                this.targetNodeDropdown,
                this.useSelectedNodeCheckbox
            ]),
            this.accordion,
            this.customDirInput
        ]);

        this.loadGallerySettings();
    }

    // Static constants for settings
    static THUMBNAIL_SIZE_MIN = 150;
    static THUMBNAIL_SIZE_MAX = 500;
    static THUMBNAIL_SIZE_STEP = 25;
    static THUMBNAIL_SIZE_DEFAULT = 300;

    // ====== Directory Management ======

    async loadGallerySettings() {
        try {
            const resp = await api.fetchApi('/neo_gallery/get_settings');
            if (resp.ok) {
                const settings = await resp.json();
                const customDir = settings.custom_directory || "";
                this.customDirInput.value = customDir;
                
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
        await this.components.buildDirModal(this);
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
            await this.sortAndDisplayImages();
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

    // ====== Data Loading ======

    async loadGallery() {
        try {
            const resp = await api.fetchApi('/neo_gallery/list');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.allCustomDirs = (data.custom_dirs || []).map(dir => ({
                name: dir.name,
                path: dir.path,
                items: dir.items || [],
                subdirs: dir.subdirs || {}
            }));
            this.allPresets = data.presets || [];
            this.allPresetsSubdirs = data.presets_subdirs || {};
            this.filteredCustomDirs = this.allCustomDirs;
            this.filteredPresets = this.allPresets;
        } catch (error) {
            console.error('Error loading gallery:', error);
            this.allCustomDirs = [];
            this.allPresets = [];
            this.allPresetsSubdirs = {};
            this.filteredCustomDirs = [];
            this.filteredPresets = [];
        }
    }

    // ====== Rendering ======

    async sortAndDisplayImages() {
        this.accordion.innerHTML = "";

        const customDirsToDisplay = this.isSearchActive ? this.filteredCustomDirs : this.allCustomDirs;
        const presetsToDisplay = this.isSearchActive ? this.filteredPresets : this.allPresets;

        if (this.currentView.mode === 'directory' && this._currentDirStructure) {
            this.renderDirectoryStructure(this._currentDirStructure, this.currentView.source, this.currentView.categoryPath);
            return;
        }

        if (this.currentView.mode === 'images') {
            this.renderExpandedImages();
            return;
        }

        const totalDirs = customDirsToDisplay.filter(d => d.items.length > 0).length;
        const totalPresets = presetsToDisplay.length;

        if (totalDirs === 0 && totalPresets === 0 && !this.isSearchActive) {
            this.displayNoFilesMessage();
            return;
        }

        if (totalDirs === 0 && totalPresets === 0 && this.isSearchActive) {
            showNoFilesMessage(this.accordion, "No matching images found");
            return;
        }

        const cardContainer = await this.createCategoryCardGrid(customDirsToDisplay, presetsToDisplay);
        if (cardContainer) {
            this.accordion.appendChild(cardContainer);
        }
    }

    async createCategoryCardGrid(dirGroups, presetItems) {
        const presetGroups = new Map();
        presetItems.forEach(item => {
            const cat = item.category || "";
            if (!presetGroups.has(cat)) presetGroups.set(cat, []);
            presetGroups.get(cat).push(item);
        });

        const container = $el("div", {
            className: "neo-gallery-category-grid",
            style: { gridTemplateColumns: `repeat(auto-fill, ${this.maxThumbnailSize}px)` }
        });

        for (const dir of dirGroups) {
            if (dir.items.length === 0 && !dir.subdirs) continue;
            const card = await this.components.createDirCard(this, dir.name, dir.path, dir.items, dir.subdirs);
            container.appendChild(card);
        }

        const allCategories = [...presetGroups.keys()].sort((a, b) => {
            if (!a) return -1;
            if (!b) return 1;
            return a.localeCompare(b);
        });

        // presets 显示为目录卡片（非递归）
        for (const cat of allCategories) {
            const groupItems = presetGroups.get(cat);
            const title = cat ? `Presets/${cat}` : "Presets";
            const card = await this.components.createPresetCategoryCard(this, title, groupItems, cat);
            container.appendChild(card);
        }

        // 显示 presets 子目录卡片
        const presetsSubdirs = this.allPresetsSubdirs || {};
        for (const subdirName of Object.keys(presetsSubdirs).sort()) {
            const subdirItems = presetsSubdirs[subdirName];
            if (subdirItems.length === 0) continue;
            const card = await this.components.createSubdirCard(this, subdirName, 'presets', [subdirName]);
            container.appendChild(card);
        }

        return container;
    }

    async showDirectoryStructure(source, pathSegments = []) {
        const dirName = source;
        const relPath = pathSegments.join("/");
        
        try {
            const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(dirName)}&path=${encodeURIComponent(relPath)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            
            const structure = await resp.json();
            
            this.currentView.mode = 'directory';
            this.currentView.source = dirName;
            this.currentView.categoryPath = pathSegments;
            this._currentDirStructure = structure;
            
            this.components.updateBreadcrumb(this, pathSegments, '');
            
            this.renderDirectoryStructure(structure, dirName, pathSegments);
        } catch (error) {
            console.error('[Gallery] Error loading directory structure:', error);
            showToast(this.app, 'error', 'Error', 'Failed to load directory structure');
        }
    }

    renderDirectoryStructure(structure, dirName, pathSegments) {
        this.accordion.innerHTML = "";
        
        const { subdirs, images, has_subdirs, image_count, total_images } = structure;
        
        if (has_subdirs && subdirs.length > 0) {
            this.renderSubdirCards(structure, dirName, pathSegments);
        } else {
            this.renderImagesFromStructure(images, dirName, pathSegments);
        }
    }

    async renderSubdirCards(structure, dirName, pathSegments) {
        const { subdirs, images, image_count, total_images } = structure;
        
        const summaryEl = $el("div", {
            className: "neo-gallery-dir-summary",
            textContent: `${total_images} items in ${subdirs.length} folders`
        });
        this.accordion.appendChild(summaryEl);
        
        const container = $el("div", {
            className: "neo-gallery-category-grid",
            style: { gridTemplateColumns: `repeat(auto-fill, ${this.maxThumbnailSize}px)` }
        });
        
        for (const subdir of subdirs) {
            const card = await this.components.createSubdirCard(this, subdir, dirName, [...pathSegments, subdir]);
            container.appendChild(card);
        }
        
        if (subdirs.length > 0) {
            this.accordion.appendChild(container);
        }
        
        if (image_count > 0) {
            const separator = $el("div", {
                className: "neo-gallery-section-separator",
                textContent: `Files in this folder (${image_count})`
            });
            this.accordion.appendChild(separator);
            
            const imageGrid = $el("div", { className: "neo-gallery-image-grid" });
            
            let currentSubfolder;
            if (pathSegments.length > 0) {
                currentSubfolder = dirName + "/" + pathSegments.join("/");
            } else {
                currentSubfolder = dirName;
            }
            
            for (let i = 0; i < Math.min(20, images.length); i++) {
                // Add subfolder to item so it's available when sending
                const itemWithSubfolder = {...images[i], subfolder: currentSubfolder};
                const imgEl = this.components.createImageElement(this, itemWithSubfolder, currentSubfolder);
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

    renderImagesFromStructure(images, dirName, pathSegments) {
        let subfolder;
        if (pathSegments.length > 0) {
            subfolder = dirName + "/" + pathSegments.join("/");
        } else {
            subfolder = dirName;
        }
        
        if (images.length === 0) {
            showNoFilesMessage(this.accordion, "No images found in this folder");
            return;
        }

        const sortedItems = sortByMtime(images);
        this._renderQueue = [...sortedItems];
        this._renderedCount = 0;
        
        const imageGrid = $el("div", { className: "neo-gallery-image-grid neo-gallery-expanded-images" });
        
        const renderPage = (count) => {
            for (let i = 0; i < count && this._renderQueue.length > 0; i++) {
                const item = this._renderQueue.shift();
                // Use item's subfolder if available, otherwise use the current subfolder
                const itemSubfolder = item.subfolder || subfolder;
                // Add subfolder to item so it's available when sending
                const itemWithSubfolder = {...item, subfolder: itemSubfolder};
                const el = this.components.createImageElement(this, itemWithSubfolder, itemSubfolder);
                if (!isImageFile(item.filename)) {
                    el.style.width = `${this.maxThumbnailSize}px`;
                }
                imageGrid.appendChild(el);
            }
            this._renderedCount += count;
        };

        this.accordion.appendChild(imageGrid);
        renderPage(PAGE_SIZE);
        
        if (this._renderQueue.length > 0) {
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
        this.showDirectoryStructure(source, pathSegments || []);
    }

    async showPresetCategory(rawCategory, title) {
        this._presetRawCategory = rawCategory;
        
        // 直接显示该 category 下的图片，而不是跳转到目录结构
        this.currentView.mode = 'images';
        this.currentView.source = 'presets';
        this.currentView.categoryPath = rawCategory ? [rawCategory] : [];
        
        this.components.updateBreadcrumb(this, rawCategory ? [rawCategory] : [], 'Presets');
        
        this.accordion.innerHTML = "";
        this.renderExpandedImages();
    }

    async showPresetDirectory(rawCategory) {
        const dirName = 'presets';
        
        if (rawCategory && rawCategory !== '') {
            try {
                const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(dirName)}&path=${encodeURIComponent(rawCategory)}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                
                const structure = await resp.json();
                
                this.currentView.mode = 'directory';
                this.currentView.source = dirName;
                this.currentView.categoryPath = [rawCategory];
                this._currentDirStructure = structure;
                
                this.components.updateBreadcrumb(this, [rawCategory], '');
                
                this.renderDirectoryStructure(structure, dirName, [rawCategory]);
            } catch (error) {
                console.error('[Gallery] Error loading preset directory:', error);
                showToast(this.app, 'error', 'Error', 'Failed to load preset category');
            }
        } else {
            try {
                const resp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(dirName)}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                
                const structure = await resp.json();
                
                this.currentView.mode = 'directory';
                this.currentView.source = dirName;
                this.currentView.categoryPath = [];
                this._currentDirStructure = structure;
                
                this.components.updateBreadcrumb(this, [], '');
                
                this.renderDirectoryStructure(structure, dirName, []);
            } catch (error) {
                console.error('[Gallery] Error loading presets:', error);
                showToast(this.app, 'error', 'Error', 'Failed to load presets');
            }
        }
    }

    async showCategoryCards() {
        this.currentView.mode = 'categories';
        this.currentView.source = null;
        this.currentView.categoryPath = [];
        
        const breadcrumb = document.getElementById("neo-gallery-breadcrumb");
        if (breadcrumb) {
            breadcrumb.style.display = 'none';
        }

        await this.sortAndDisplayImages();
    }

    renderExpandedImages() {
        const { source, categoryPath } = this.currentView;
        
        let items = [];
        let subfolder = source;

        if (source === 'presets') {
            const catToMatch = this._presetRawCategory || '';
            items = this.allPresets.filter(i => i.category === catToMatch);
            // Use item's subfolder directly (backend returns relative path like "26-06-26" or "" for root)
            if (items.length > 0) {
                subfolder = items[0].subfolder || '';
            } else if (categoryPath && categoryPath.length > 0) {
                subfolder = categoryPath.join("/");
            }
        } else {
            const dir = this.allCustomDirs.find(d => d.name === source);
            if (dir) {
                subfolder = source;
                if (categoryPath.length > 0) {
                    const catKey = categoryPath[0];
                    items = dir.items.filter(i => i.category === catKey || (!i.category && !catKey));
                } else {
                    items = [...dir.items];
                }
            }
        }

        if (items.length === 0) {
            showNoFilesMessage(this.accordion, "No images found in this category");
            return;
        }

        const sortedItems = sortByMtime(items);
        this._renderQueue = [...sortedItems];
        this._renderedCount = 0;
        
        const imageGrid = $el("div", { className: "neo-gallery-image-grid neo-gallery-expanded-images" });
        
        const renderPage = (count) => {
            for (let i = 0; i < count && this._renderQueue.length > 0; i++) {
                const item = this._renderQueue.shift();
                // Add subfolder to item so it's available when sending
                const itemWithSubfolder = {...item, subfolder: subfolder};
                const el = this.components.createImageElement(this, itemWithSubfolder, subfolder);
                if (!isImageFile(item.filename)) {
                    el.style.width = `${this.maxThumbnailSize}px`;
                }
                imageGrid.appendChild(el);
            }
            this._renderedCount += count;
        };

        this.accordion.appendChild(imageGrid);
        renderPage(PAGE_SIZE);
        
        if (this._renderQueue.length > 0) {
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
                for (const dir of this.allCustomDirs) {
                    dir.items = dir.items.filter(item => item.name !== name);
                }
                this.allPresets = this.allPresets.filter(item => item.name !== name);
                
                if (this.isSearchActive) {
                    await this.handleSearch(this.searchInput.value);
                } else {
                    await this.sortAndDisplayImages();
                }
                showToast(this.app, 'success', 'Deleted', `Removed: ${name}`);
            } else {
                showToast(this.app, 'warning', 'Delete Failed', 'Item not found or already deleted.');
            }
        } catch (error) {
            console.error("Error deleting item:", error);
            showToast(this.app, 'error', 'Delete Failed', error.message);
        }
    }

    async handleSearch(searchTerm) {
        searchTerm = searchTerm.toLowerCase();
        this.isSearchActive = searchTerm.length > 0;
        
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
        
        this.currentView.mode = 'categories';
        this.currentView.source = null;
        this.currentView.categoryPath = [];
        
        await this.sortAndDisplayImages();
    }

    async updateThumbnailSize(newSize) {
        this.maxThumbnailSize = newSize;
        if (this.thumbnailSizeSlider) {
            const slider = this.thumbnailSizeSlider.querySelector("input[type='range']");
            if (slider) slider.value = newSize;
        }
        const grids = document.querySelectorAll('.neo-gallery-category-grid');
        for (const grid of grids) {
            if (grid.offsetParent !== null) {
                grid.style.gridTemplateColumns = `repeat(auto-fill, ${newSize}px)`;
            }
        }
        await this.sortAndDisplayImages();
    }

    async updateLabelDisplay(display) {
        this.displayLabels = display;
        await this.sortAndDisplayImages();
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

    // ====== Utility ======

    debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    showToast(severity, summary, detail) {
        showToast(this.app, severity, summary, detail);
    }

    showInlineFeedback(button, message, type) {
        showInlineFeedback(button, message, type);
    }

    displayNoFilesMessage() {
        this.accordion.appendChild($el("div", {
            className: "neo-gallery-no-files-message"
        }, [
            $el("div", { className: "neo-gallery-no-files-message-icon", textContent: "\uD83D\uDCF7" }),
            $el("p", { className: "neo-gallery-no-files-message-text", textContent: "No presets found. Add images + .txt files to gallery/presets/ or click \u{1F4C1} to add custom directories." })
        ]));
    }

    // ====== Image Send ======

    async sendImageToNode(image, target, button) {
        const selectedValue = target === 'selected' ? 'selected' : target;
        let targetNode = null;
        let targetWidget = null;
        if (selectedValue === 'selected') {
            const selKeys = Object.keys(app.canvas.selected_nodes);
            if (selKeys.length > 0) {
                targetNode = app.canvas.selected_nodes[selKeys[0]];
                targetWidget = targetNode?.widgets?.find(w => /image|upload/.test((w.name||'').toLowerCase()));
            }
        } else {
            const [nodeId, , index] = selectedValue.split(':');
            targetNode = app.graph.getNodeById(parseInt(nodeId));
            targetWidget = targetNode?.widgets?.[parseInt(index)];
        }
        if (!targetNode || !targetWidget) {
            showToast(this.app, 'error', 'Send Failed', 'Could not find target node/widget.');
            return;
        }
        const widgetType = targetWidget.type || '';
        
        if (widgetType === 'combo') {
            try {
                const resp = await api.fetchApi('/neo_gallery/copy_to_input?filename=' + encodeURIComponent(image.filename) + (image.subfolder ? '&subfolder=' + encodeURIComponent(image.subfolder) : ''));
                if (resp.ok) {
                    const result = await resp.json();
                    if (result.success) {
                        targetWidget.value = result.skipped ? image.filename : result.filename;
                    } else {
                        showToast(this.app, 'error', 'Copy Failed', result.error || 'Failed to copy image to input directory');
                        return;
                    }
                } else {
                    showToast(this.app, 'error', 'Copy Failed', 'Failed to copy image');
                    return;
                }
            } catch (e) {
                console.error('[Gallery] Error copying image:', e);
                showToast(this.app, 'error', 'Copy Failed', 'Error copying image');
                return;
            }
        } else {
            const filePath = `${image.subfolder || ''}/${image.filename}`;
            if (widgetType === 'customtext' || widgetType === 'text') {
                targetWidget.value = filePath;
            } else {
                targetWidget.value = {
                    filename: image.filename,
                    subfolder: image.subfolder || '',
                    type: image.type || 'input'
                };
            }
        }
        if (widgetType === 'combo' && targetWidget.callback) {
            targetWidget.callback(targetWidget.value);
        } else if (targetNode.onWidgetChanged) {
            targetNode.onWidgetChanged(targetWidget.name, targetWidget.value);
        }
        app.graph.setDirtyCanvas(true, true);
        showInlineFeedback(button, '\u2705 Image Sent!', 'success');
        showToast(this.app, 'success', 'Image Sent!', `Sent to ${targetNode.title || 'Node'} - ${targetWidget.name}`);
    }

    // ====== Lightbox (delegated to components) ======

    injectAnimations() {}

    showLightbox(image, subfolder) {
        this.components.showLightbox(this, image, subfolder);
    }

    closeLightbox() {
        this.components.closeLightbox(this);
    }

    navigateLightboxImage(direction) {
        this.components.navigateLightboxImage(this, direction);
    }

    updateLightboxContent(lightbox, image, subfolder, allImages, currentIndex) {
        this.components.updateLightboxContent(this, lightbox, image, subfolder, allImages, currentIndex);
    }

    // ====== Breadcrumb (delegated to components) ======

    createBreadcrumbHome() {
        return this.components.createBreadcrumbHome(this);
    }

    updateBreadcrumb(pathSegments, sourceName) {
        this.components.updateBreadcrumb(this, pathSegments, sourceName);
    }

    _removeSiblingDropdown() {
        this.components._removeSiblingDropdown();
    }

    _toggleSiblingDropdown(event, rootDirName, pathSegments) {
        this.components._toggleSiblingDropdown(this, event, rootDirName, pathSegments);
    }

    // ====== Send Menus (delegated to components) ======

    _removeSendMenu() {
        this.components._removeSendMenu();
    }

    _removeImgSendMenu() {
        this.components._removeImgSendMenu();
    }

    _showImgSendMenu(image, button) {
        this.components._showImgSendMenu(this, image, button);
    }

    _showSendMenu(image, button) {
        this.components._showSendMenu(this, image, button);
    }

    // ====== Main init ======

    async init() {
        await this.loadPluginData();
    }

    async loadAndDisplay() {
        this.accordion.innerHTML = '';
        const loadingEl = showLoadingOverlay(this.accordion);
        
        await Promise.resolve();
        
        await this.loadGallery();
        
        if (loadingEl.parentNode) loadingEl.remove();
        await this.sortAndDisplayImages();
    }
}

// ====== Extension Registration =====
app.registerExtension({
    name: "comfy.neo.gallery",
    async setup() {
        const gallery = new NeoGallery(app);
        app.neoGallery = gallery;
        await gallery.init();

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
                el.innerHTML = "";
                
                if (gallery.element.parentNode) {
                    gallery.element.parentNode.removeChild(gallery.element);
                }
                el.appendChild(gallery.element);
                
                if (!gallery._loaded) {
                    await gallery.loadAndDisplay();
                    gallery._loaded = true;
                } else {
                    gallery.accordion.innerHTML = "";
                    await gallery.sortAndDisplayImages();
                }
            },
            });
        }
    },
});