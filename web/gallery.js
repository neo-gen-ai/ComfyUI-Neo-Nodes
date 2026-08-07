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
        this.maxThumbnailSize = 320;
        this.displayLabels = true;
        this.allDirectories = [];
        this.filteredDirectories = [];
        this.sortAscending = true;
        this._renderQueue = [];
        this._renderedCount = 0;
        this.isFocused = false;
        this.isVisible = false;
        
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
            this.accordion,
            this.customDirInput
        ]);

        this.loadGallerySettings();
    }

    // Static constants for settings
    static THUMBNAIL_SIZE_MIN = 150;
    static THUMBNAIL_SIZE_MAX = 500;
    static THUMBNAIL_SIZE_STEP = 25;
    static THUMBNAIL_SIZE_DEFAULT = 320;

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
    // Clear thumbnails for this directory
    try {
            await api.fetchApi('/neo_gallery/clear_thumbnails', {
            method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subfolder: dirPath })
                });
            } catch (e) {
                console.warn('[Neo Gallery] Failed to clear thumbnails:', e);
            }
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
            // Use lazy loading for faster initial load
            const resp = await api.fetchApi('/neo_gallery/list?lazy=1');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.allDirectories = (data.directories || []).map(dir => ({
                name: dir.name,
                path: dir.path,
                items: dir.items || [],
                subdirs: dir.subdirs || {},
                read_only: dir.read_only || false,
                lazy: dir.lazy || false,
                root_count: dir.root_count || 0
            }));
            this.filteredDirectories = this.allDirectories;
        } catch (error) {
            console.error('Error loading gallery:', error);
            this.allDirectories = [];
            this.filteredDirectories = [];
        }
    }

    // ====== Rendering ======

    async sortAndDisplayImages() {
        this.accordion.innerHTML = "";

        const dirsToDisplay = this.isSearchActive ? this.filteredDirectories : this.allDirectories;

        if (this.currentView.mode === 'directory' && this._currentDirStructure) {
            this.renderDirectoryStructure(this._currentDirStructure, this.currentView.source, this.currentView.categoryPath);
            return;
        }

        if (this.currentView.mode === 'images') {
            this.renderExpandedImages();
            return;
        }

        // In lazy mode, count dirs with subdirs or items
        const totalDirs = dirsToDisplay.filter(d => 
            d.items.length > 0 || (d.subdirs && Object.keys(d.subdirs).length > 0)
        ).length;

        if (totalDirs === 0 && !this.isSearchActive) {
            this.displayNoFilesMessage();
            return;
        }

        if (totalDirs === 0 && this.isSearchActive) {
            showNoFilesMessage(this.accordion, "No matching images found");
            return;
        }

        const cardContainer = await this.createCategoryCardGrid(dirsToDisplay);
        if (cardContainer) {
            this.accordion.appendChild(cardContainer);
        }
    }

    async createCategoryCardGrid(dirGroups) {
        const container = $el("div", {
            className: "neo-gallery-category-grid",
            style: { gridTemplateColumns: `repeat(auto-fill, ${this.maxThumbnailSize}px)` }
        });

        for (const dir of dirGroups) {
            // In lazy mode, show cards if there are items, subdirs, or root_count
            const hasContent = dir.items.length > 0 || 
                               (dir.subdirs && Object.keys(dir.subdirs).length > 0) ||
                               (dir.root_count && dir.root_count > 0);
            if (!hasContent) continue;
            const card = await this.components.createDirCard(this, dir.name, dir.path, dir.items, dir.subdirs, dir.read_only);
            container.appendChild(card);
        }

        return container;
    }

    async showDirectoryStructure(source, pathSegments = []) {
        const dirName = source;
        const relPath = pathSegments.join("/");
        
        try {
            // Use lazy loading for faster initial load
            const resp = await api.fetchApi(`/neo_gallery/dir_structure_lazy?dir_name=${encodeURIComponent(dirName)}&path=${encodeURIComponent(relPath)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            
            const structure = await resp.json();
            
            // Also fetch image entries for the current directory
            if (pathSegments.length > 0) {
                // Subdirectory: use dir_structure endpoint for accurate per-path results
                const structResp = await api.fetchApi(`/neo_gallery/dir_structure?dir_name=${encodeURIComponent(dirName)}&path=${encodeURIComponent(relPath)}`);
                if (structResp.ok) {
                    const structData = await structResp.json();
                    if (structData.images && structData.images.length > 0) {
                        structure.images = structData.images;
                        structure.image_count = structData.image_count;
                    }
                }
            } else {
                // Root level: use the already-loaded list
                const listResp = await api.fetchApi(`/neo_gallery/list`);
                if (listResp.ok) {
                    const listData = await listResp.json();
                    const dir = listData.directories?.find(d => 
                        d.path === structure.path || d.name === structure.dir_name
                    );
                    if (dir && dir.items && dir.items.length > 0) {
                        structure.images = dir.items;
                        structure.image_count = dir.items.length;
                    }
                }
            }
            
            this.currentView.mode = 'directory';
            this.currentView.source = dirName;
            this.currentView.categoryPath = pathSegments;
            this._currentDirStructure = structure;
            
            this.components.updateBreadcrumb(this, pathSegments, '');
            
            this.renderDirectoryStructure(structure, dirName, pathSegments);
            
            // Push state to history for back button support (use query param to avoid conflict with workflow hash)
            const stateKey = `gallery_${dirName}_${pathSegments.join('/')}`;
            const currentUrl = new URL(window.location.href);
            currentUrl.searchParams.set('gallery', stateKey);
            history.pushState({ galleryState: stateKey }, '', currentUrl.toString());

        } catch (error) {
            console.error('[Gallery] Error loading directory structure:', error);
            showToast(this.app, 'error', 'Error', 'Failed to load directory structure');
        }
    }

    renderDirectoryStructure(structure, dirName, pathSegments) {
        this.accordion.innerHTML = "";
        
        const { subdirs, images, has_subdirs, image_count, total_images, root_count } = structure;
        
        // Handle lazy-loaded structure (images may be undefined, has_subdirs may be undefined)
        const imageArray = images || [];
        const subdirArray = Array.isArray(subdirs) ? subdirs : Object.values(subdirs || {});
        
        // For lazy-loaded: has_subdirs may be undefined, but subdirs has content
        // For normal: has_subdirs is boolean, subdirs is array of strings
        const hasSubdirs = has_subdirs || subdirArray.length > 0;
        
        if (hasSubdirs) {
            this.renderSubdirCards(structure, dirName, pathSegments);
        } else if (imageArray.length > 0) {
            this.renderImagesFromStructure(imageArray, dirName, pathSegments);
        } else {
            showNoFilesMessage(this.accordion, "No images found in this folder");
        }
    }

    async renderSubdirCards(structure, dirName, pathSegments) {
        const { subdirs, images, image_count, total_images, root_count } = structure;
        
        // Handle lazy-loaded structure (only has root_count and subdirs)
        const displayTotal = total_images || root_count || 0;
        const displaySubdirs = Array.isArray(subdirs) ? subdirs : Object.keys(subdirs || {});
        
        // For lazy-loaded, subdirArray is object values; for normal, it's string array
        const subdirArray = Array.isArray(subdirs) ? subdirs : Object.values(subdirs || {});
        
        const container = $el("div", {
            className: "neo-gallery-category-grid",
            style: { gridTemplateColumns: `repeat(auto-fill, ${this.maxThumbnailSize}px)` }
        });
        
        const subdirList = Array.isArray(subdirs) ? subdirs : Object.values(subdirs || {});
        for (const subdir of subdirList) {
            // Handle both string (old format) and object (new lazy format)
            const subdirName = typeof subdir === 'string' ? subdir : subdir.path || subdir.name;
            const subdirParts = subdirName.split("/");
            const fullPath = [...pathSegments, ...subdirParts];
            
            // Check if subdir has content before creating card
            const subdirResp = await api.fetchApi(`/neo_gallery/dir_structure_lazy?dir_name=${encodeURIComponent(dirName)}&path=${encodeURIComponent(fullPath.join('/'))}`);
            if (subdirResp.ok) {
                const subdirData = await subdirResp.json();
                const subdirCount = subdirData.root_count || 0;
                const subdirSubdirs = subdirData.subdirs || {};
                
                // Skip empty directories
                if (subdirCount === 0 && Object.keys(subdirSubdirs).length === 0) {
                    continue;
                }
            }
            
            const card = await this.components.createSubdirCard(this, subdirName, dirName, fullPath);
            container.appendChild(card);
        }
        
        if (subdirArray.length > 0) {
            this.accordion.appendChild(container);
        }
        
        // Only show images section if we have actual image data (not lazy-loaded)
        if (images && images.length > 0) {
            
            const imageGrid = $el("div", { className: "neo-gallery-image-grid" });
            
            let currentSubfolder;
            if (pathSegments.length > 0) {
                currentSubfolder = dirName + "/" + pathSegments.join("/");
            } else {
                currentSubfolder = dirName;
            }
            
            for (let i = 0; i < Math.min(20, images.length); i++) {
                // Use item's own subfolder if available (from backend), otherwise use current directory path
                const itemSubfolder = images[i].subfolder || currentSubfolder;
                const itemWithSubfolder = {...images[i], subfolder: itemSubfolder};
                const imgEl = this.components.createImageElement(this, itemWithSubfolder, itemSubfolder);
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

    async showCategoryCards() {
        this.currentView.mode = 'categories';
        this.currentView.source = null;
        this.currentView.categoryPath = [];
        
        const breadcrumb = document.getElementById("neo-gallery-breadcrumb");
        if (breadcrumb) {
            breadcrumb.style.display = 'none';
        }

        // Remove gallery query param when going back to categories
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete('gallery');
        history.replaceState(null, '', currentUrl.toString());

        await this.sortAndDisplayImages();
    }

    renderExpandedImages() {
        const { source, categoryPath } = this.currentView;
        
        let items = [];
        let subfolder = source;

        const dir = this.allDirectories.find(d => d.name === source);
        if (dir) {
            subfolder = source;
            if (categoryPath.length > 0) {
                const catKey = categoryPath[0];
                items = dir.items.filter(i => i.category === catKey || (!i.category && !catKey));
            } else {
                items = [...dir.items];
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
                // Clear thumbnail cache for this item
                try {
                    await api.fetchApi('/neo_gallery/clear_thumbnails', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ subfolder })
                    });
                } catch (e) { console.warn('[Gallery] Failed to clear thumbnails:', e); }
                
                for (const dir of this.allDirectories) {
                    dir.items = dir.items.filter(item => item.name !== name);
                }
                
                if (this.isSearchActive) {
                    await this.handleSearch(this.searchInput.value);
                } else {
                    await this.sortAndDisplayImages();
                }
                
                // Remove DOM element after re-render
                const thumbContainers = document.querySelectorAll('.neo-gallery-thumb-container');
                for (const container of thumbContainers) {
                    if (container.dataset.filename === name && container.dataset.subfolder === subfolder) {
                        container.remove();
                        break;
                    }
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
        
        this.filteredDirectories = this.allDirectories.map(dir => ({
            ...dir,
            items: dir.items.filter(img =>
                (img.name && img.name.toLowerCase().includes(searchTerm)) ||
                (img.style && img.style.toLowerCase().includes(searchTerm)) ||
                (img.content && img.content.toLowerCase().includes(searchTerm))
            )
        })).filter(dir => dir.items.length > 0);
        
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

    // ====== Video Send ======

    async sendVideoToNode(image, target, button) {
        const selectedValue = target === 'selected' ? 'selected' : target;
        let targetNode = null;
        let targetWidget = null;
        if (selectedValue === 'selected') {
            const selKeys = Object.keys(app.canvas.selected_nodes);
            if (selKeys.length > 0) {
                targetNode = app.canvas.selected_nodes[selKeys[0]];
                targetWidget = targetNode?.widgets?.find(w => /video/.test((w.name||'').toLowerCase()));
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
                        showToast(this.app, 'error', 'Copy Failed', result.error || 'Failed to copy video to input directory');
                        return;
                    }
                } else {
                    showToast(this.app, 'error', 'Copy Failed', 'Failed to copy video');
                    return;
                }
            } catch (e) {
                console.error('[Gallery] Error copying video:', e);
                showToast(this.app, 'error', 'Copy Failed', 'Error copying video');
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
        showInlineFeedback(button, '\u2705 Video Sent!', 'success');
        showToast(this.app, 'success', 'Video Sent!', `Sent to ${targetNode.title || 'Node'} - ${targetWidget.name}`);
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

    _showVideoSendMenu(image, button) {
        this.components._showVideoSendMenu(this, image, button);
    }

    // ====== Main init ======

    async init() {
        await this.loadPluginData();
        
        // Restore gallery state from URL query param on page load
        const params = new URLSearchParams(window.location.search);
        const galleryParam = params.get('gallery');
        if (galleryParam) {
            const match = galleryParam.match(/^gallery_(.+?)_(.*)$/);
            if (match) {
                const dirName = match[1];
                const pathStr = match[2];
                const pathSegments = pathStr ? pathStr.split('/') : [];
                this.currentView.mode = 'directory';
                this.currentView.source = dirName;
                this.currentView.categoryPath = pathSegments;
                // Load gallery data first so breadcrumb can initialize properly
                await this.loadGallery();
                await this.showDirectoryStructure(dirName, pathSegments);
                return; // skip normal init
            }
        }

        // Intercept browser back button when gallery is visible
        window.addEventListener('popstate', (e) => {
            if (!this.isVisible) return;
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
            if (this.currentView.mode === 'directory' && this.currentView.categoryPath.length > 0) {
                const parentPath = this.currentView.categoryPath.slice(0, -1);
                this.showDirectoryStructure(this.currentView.source, parentPath);
            } else {
                this.showCategoryCards();
            }
        });

        // Intercept keyboard back navigation (Alt+Left, Backspace) - use capture to beat ComfyUI
        window.addEventListener('keydown', (e) => {
            if (!this.isVisible) return;
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
            
            if ((e.altKey && e.key === 'ArrowLeft') || (e.ctrlKey && e.key === 'ArrowLeft')) {
                e.preventDefault();
                e.stopPropagation();
                if (this.currentView.mode === 'directory' && this.currentView.categoryPath.length > 0) {
                    const parentPath = this.currentView.categoryPath.slice(0, -1);
                    this.showDirectoryStructure(this.currentView.source, parentPath);
                } else {
                    this.showCategoryCards();
                }
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                e.stopPropagation();
                if (this.currentView.mode === 'directory' && this.currentView.categoryPath.length > 0) {
                    const parentPath = this.currentView.categoryPath.slice(0, -1);
                    this.showDirectoryStructure(this.currentView.source, parentPath);
                } else {
                    this.showCategoryCards();
                }
            }
        }, true);
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
            type: "slider", attrs: { min: 150, max: 500, step: 25 }, defaultValue: 320,
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
                // Re-initialize breadcrumb if URL has gallery param (panel was mounted after init)
                const params = new URLSearchParams(window.location.search);
                const galleryParam = params.get('gallery');
                if (galleryParam && gallery.currentView.mode === 'directory') {
                    gallery.components.updateBreadcrumb(gallery, gallery.currentView.categoryPath, '');
                }
                gallery.isVisible = true;

            },
            });
        }
    },
});
