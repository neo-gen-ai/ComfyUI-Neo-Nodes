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
 * 
 * Data model:
 *  - /neo_gallery/list returns { presets: [...], custom: [...] }
 *  - Each entry: { name, filename, txt_file, preview, style, elements, content, composition, lighting, materials, anatomy, pose }
 *  - Images served via /neo_gallery/image?filename=xxx&subfolder=presets|custom
 *  - Upload via /neo_gallery/upload (POST form: image)
 *  - Delete via /neo_gallery/delete (POST JSON: { filename, subfolder })
 */
class NeoGallery {
    constructor(app) {
        this.app = app;
        this.maxThumbnailSize = 100;
        this.displayLabels = true;
        this.allPresets = [];
        this.allCustom = [];
        this.filteredPresets = [];
        this.filteredCustom = [];
        this.sortAscending = true;
        this.searchInput = this.createSearchInput();
        this.targetNodeDropdown = this.createTargetNodeDropdown();
        this.thumbnailSizeSlider = this.createThumbnailSizeSlider();
        this.accordion = $el("div.neo-gallery-accordion");
        this.placeholderImageUrl = `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=SKIP.jpeg`;
        this.sectionStates = {};
        this.isSearchActive = false;

        // Use a unique ID so we can find and clean up old instances across all containers
        this.elementId = "neo-gallery-panel-root";
        this.element = $el("div", { id: this.elementId, className: "neo-gallery-panel" }, [
            $el("h3", { className: "neo-gallery-header", textContent: "Neo Gallery" }),
            $el("div", { className: "neo-gallery-search-row" }, [
                $el("div", { className: "neo-gallery-search-container" }, [this.searchInput]),
                $el("div", { className: "neo-gallery-dropdown-container" }, [this.targetNodeDropdown])
            ]),
            this.accordion,
            // Thumbnail Size - at bottom of panel
            $el("div", { className: "neo-gallery-size-control" }, [
                $el("span", { className: "neo-gallery-size-label", textContent: "Size:" }),
                this.thumbnailSizeSlider
            ])
        ]);
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
                this.maxThumbnailSize = data.maxThumbnailSize || 100;
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
        dropdown.appendChild($el("option", { value: "selected", textContent: "⭐ Active Selected Node", id: "selected-node-option" }));
        
        // Clipboard fallback option
        dropdown.appendChild($el("option", { value: "clipboard", textContent: "📋 None (Copy to Clipboard)" }));
        dropdown.appendChild($el("option", { disabled: true }));

        // Section header for prompts.js nodes (NeoPromptEncoder / NeoPromptGenerator)
        const addPromptsHeader = () => {
            const promptsNodes = app.graph._nodes.filter(n => n._rsPromptUIElements);
            if (promptsNodes.length > 0) {
                let existingHeader = dropdown.querySelector('.rs-prompts-section-header');
                if (!existingHeader) {
                    const headerOption = $el("option", {
                        className: 'rs-prompts-section-header',
                        disabled: true,
                        textContent: "── Prompt Encoder / Generator ──"
                    });
                    if (dropdown.children.length >= 3) {
                        dropdown.insertBefore(headerOption, dropdown.children[3]);
                    } else {
                        dropdown.appendChild(headerOption);
                    }
                    promptsNodes.forEach(node => {
                        const nodeType = node.type === 'NeoPromptEncoder' ? 'Encoder' : 'Generator';
                        dropdown.appendChild($el("option", {
                            value: `prompt:${node.id}`,
                            textContent: `${node.title || 'Node'} (${nodeType})`,
                            className: 'rs-prompt-node-option'
                        }));
                    });
                }
            }
        };

        const updateDropdownOptions = () => {
            // Keep first 4 options: placeholder, active selection, clipboard, separator
            while (dropdown.children.length > 4) {
                dropdown.removeChild(dropdown.lastChild);
            }

            // Update active selected node option text (always visible)
            const selectedKeys = Object.keys(app.canvas.selected_nodes);
            const activeOption = dropdown.querySelector('#selected-node-option');
            if (activeOption) {
                activeOption.textContent = '⭐ Active Selected Node';
                activeOption.style.display = '';
            }

            // Add section header for regular text input nodes
            const hasRegularTextNodes = app.graph._nodes.some(node => {
                const nodeType = node.type || '';
                const nodeName = (node.title || '').toLowerCase();
                if (nodeType.includes('negative') || nodeName.includes('negative')) return false;
                return node.widgets?.some(w => w.inputEl && ['string', 'text', 'customtext'].includes(w.type));
            });

            if (hasRegularTextNodes) {
                let regularHeader = dropdown.querySelector('.rs-regular-section-header');
                if (!regularHeader) {
                    regularHeader = $el("option", {
                        className: 'rs-regular-section-header',
                        disabled: true,
                        textContent: "── Text Input Nodes ──"
                    });
                    dropdown.appendChild(regularHeader);
                }
            }

            // Only add nodes that have text-type widgets with actual input elements
            app.graph._nodes.forEach(node => {
                // Skip negative prompt encoder nodes (output is negative prompt)
                const nodeType = node.type || '';
                const nodeName = (node.title || '').toLowerCase();
                if (nodeType.includes('negative') || nodeName.includes('negative')) {
                    return;
                }

                const textWidgets = [];
                if (node.widgets) {
                    node.widgets.forEach((widget, index) => {
                        if (widget.inputEl && ['string', 'text', 'customtext'].includes(widget.type)) {
                            textWidgets.push({ widget, index });
                        }
                    });
                }
                if (textWidgets.length > 0) {
                    textWidgets.forEach(({ widget, index }) => {
                        dropdown.appendChild($el("option", {
                            value: `${node.id}:widget:${index}`,
                            textContent: `▸ ${node.title || 'Node'} → ${widget.name}`
                        }));
                    });
                }
            });

            addPromptsHeader();
        };

        updateDropdownOptions();
        app.graph.onNodeAdded = updateDropdownOptions;
        app.graph.onNodeRemoved = updateDropdownOptions;
        return dropdown;
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
            max: 300,
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

        return $el("div", { className: "neo-gallery-slider-row" }, [slider, valueLabel]);
    }

    createAddCustomImageButton() {
        const addIconSize = Math.max(20, this.maxThumbnailSize / 3);
        const addFontSize = Math.max(12, this.maxThumbnailSize / 8);

        return $el("div", {
            className: "neo-gallery-add-button",
            style: {
                width: `${this.maxThumbnailSize}px`,
                height: `${this.maxThumbnailSize}px`
            },
            onclick: () => this.showAddCustomImageDialog()
        }, [
            $el("div", {
                className: "neo-gallery-add-icon",
                style: { fontSize: `${addIconSize}px` },
                textContent: "+"
            }),
            $el("div", {
                className: "neo-gallery-add-label",
                style: { fontSize: `${addFontSize}px` },
                textContent: "Add"
            })
        ]);
    }

    showAddCustomImageDialog() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (file) await this.uploadAndProcessFile(file);
            document.body.removeChild(fileInput);
        });

        fileInput.click();
    }

    // ====== Actions ======

    async uploadAndProcessFile(file) {
        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('subfolder', 'custom');

            const response = await api.fetchApi('/neo_gallery/upload', { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);

            const result = await response.json();
            if (!result || !result.name) throw new Error('Invalid response');

            // Immediately add to UI without waiting for reload
            const newEntry = {
                name: result.name,
                filename: result.name,
                preview: null // will be loaded via API
            };
            this.allCustom.unshift(newEntry);
            this.filteredCustom = this.allCustom;
            this.sortAndDisplayImages();

            // Then reload in background to sync with server state
            this.loadGallery();

            this.showToast('success', 'Upload Successful', `Added custom image: ${result.name}`);
        } catch (error) {
            console.error("Error uploading file:", error);
            this.showToast('error', 'Upload Failed', error.message);
        }
    }

    async deleteItem(name, subfolder) {
        try {
            const response = await api.fetchApi('/neo_gallery/delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: name, subfolder })
            });
            const result = await response.json();
            if (result.deleted) {
                // Immediately remove from UI
                if (subfolder === "custom") {
                    this.allCustom = this.allCustom.filter(item => item.name !== name);
                    this.filteredCustom = this.allCustom;
                } else {
                    this.allPresets = this.allPresets.filter(item => item.name !== name);
                    this.filteredPresets = this.allPresets;
                }
                this.sortAndDisplayImages();
                this.showToast('success', 'Deleted', `Removed: ${name}`);
                // Sync with server in background
                this.loadGallery();
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
        this.filteredPresets = this.allPresets.filter(img =>
            (img && img.name && img.name.toLowerCase().includes(searchTerm)) ||
            (img && img.style && img.style.toLowerCase().includes(searchTerm)) ||
            (img && img.content && img.content.toLowerCase().includes(searchTerm))
        );
        this.filteredCustom = this.allCustom.filter(img =>
            (img && img.name && img.name.toLowerCase().includes(searchTerm))
        );
        this.sortAndDisplayImages();
    }

    updateThumbnailSize(newSize) {
        this.maxThumbnailSize = newSize;
        // Update slider if exists
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
            this.allPresets = data.presets || [];
            this.allCustom = data.custom || [];
            console.log('Loaded presets:', this.allPresets.length, 'custom:', this.allCustom.length);
            if (this.allPresets.length > 0) {
                console.log('First preset:', this.allPresets[0]);
            }
            this.filteredPresets = this.allPresets;
            this.filteredCustom = this.allCustom;
        } catch (error) {
            console.error('Error loading gallery:', error);
            this.allPresets = [];
            this.allCustom = [];
            this.filteredPresets = [];
            this.filteredCustom = [];
        }
    }

    // ====== Rendering ======

    sortAndDisplayImages() {
        this.accordion.innerHTML = "";

        const presetsToDisplay = this.isSearchActive ? this.filteredPresets : this.allPresets;
        const customToDisplay = this.isSearchActive ? this.filteredCustom : this.allCustom;

        // Always sort alphabetically (ascending)
        const sortedPresets = [...presetsToDisplay].sort((a, b) => a.name.localeCompare(b.name));
        const sortedCustom = [...customToDisplay].sort((a, b) => a.name.localeCompare(b.name));

        if (sortedPresets.length === 0 && sortedCustom.length === 0 && !this.isSearchActive) {
            this.displayNoFilesMessage();
            return;
        }

        if (presetsToDisplay.length === 0 && customToDisplay.length === 0 && this.isSearchActive) {
            this.accordion.appendChild($el("div", {
                className: "neo-gallery-no-files"
            }, [
                $el("div", { className: "neo-gallery-no-files-icon", textContent: "😔" }),
                $el("div", { className: "neo-gallery-no-files-text", textContent: "No matching images found" })
            ]));
            return;
        }

        // Render Presets section
        if (sortedPresets.length > 0 || (!this.isSearchActive)) {
            this.accordion.appendChild(this.createAccordionSection("Presets", sortedPresets, "presets"));
        }

        // Render Custom section
        if (sortedCustom.length > 0 || !this.isSearchActive) {
            this.accordion.appendChild(this.createCustomSection(sortedCustom));
        }
    }

    createAccordionSection(title, items, subfolder) {
        const section = $el("div", {
            className: `accordion-section neo-gallery-accordion-section ${title.toLowerCase()}`
        });

        const header = $el("div", {
            className: "accordion-header neo-gallery-accordion-header"
        });

        const headerText = $el("span", { textContent: `${title} (${items.length})` });
        const indicator = $el("span", {
            className: "neo-gallery-accordion-indicator",
            textContent: this.sectionStates[title] ? "-" : "+"
        });

        // Add small Random Prompt button for Presets section
        if (title === "Presets" && items.length > 0) {
            const randomBtn = $el("button", {
                className: "neo-gallery-random-btn",
                textContent: "🎲",
                onclick: (e) => {
                    e.stopPropagation();
                    this.generateRandomPrompt();
                },
                title: "Random Prompt"
            });
            header.appendChild(randomBtn);
        }

        header.appendChild(headerText);
        header.appendChild(indicator);

        const content = $el("div", {
            className: `accordion-content neo-gallery-accordion-content ${title.toLowerCase()}`,
            style: {
                display: this.sectionStates[title] ? "flex" : "none"
            }
        });

        header.addEventListener("click", (e) => {
            if (e.target.type !== "checkbox") {
                const isHidden = content.style.display === "none";
                content.style.display = isHidden ? "flex" : "none";
                indicator.textContent = isHidden ? "-" : "+";
                this.sectionStates[title] = isHidden;
                this.savePluginData();
            }
        });

        const imageGrid = $el("div", { className: "neo-gallery-image-grid" });
        items.forEach(item => {
            const el = this.createImageElement(item, subfolder);
            // Store the default width for non-image items
            if (subfolder === "custom" || !/\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i.test(item.filename)) {
                el.style.width = `${this.maxThumbnailSize}px`;
            }
            imageGrid.appendChild(el);
        });
        content.appendChild(imageGrid);

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    createCustomSection(items) {
        const section = $el("div", { className: "accordion-section neo-gallery-accordion-section custom-section" });

        const header = $el("div", {
            className: "accordion-header neo-gallery-accordion-header"
        });

        const headerText = $el("span", { textContent: `Custom (${items.length})` });
        const indicator = $el("span", {
            className: "neo-gallery-accordion-indicator",
            textContent: this.sectionStates["Custom"] ? "-" : "+"
        });

        // Add small "Clear All Custom" button for Custom section
        if (items.length > 0) {
            const clearBtn = $el("button", {
                className: "neo-gallery-clear-btn",
                textContent: "🗑️",
                onclick: (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete all ${items.length} custom images? This cannot be undone.`)) {
                        for (const item of items) {
                            this.deleteItem(item.name, "custom");
                        }
                    }
                },
                title: "Clear All Custom"
            });
            header.appendChild(clearBtn);
        }

        header.appendChild(headerText);
        header.appendChild(indicator);

        const content = $el("div", {
            className: "accordion-content neo-gallery-accordion-content custom",
            style: {
                display: this.sectionStates["Custom"] ? "flex" : "none"
            }
        });

        header.addEventListener("click", (e) => {
            if (e.target.type !== "checkbox") {
                const isHidden = content.style.display === "none";
                content.style.display = isHidden ? "flex" : "none";
                indicator.textContent = isHidden ? "-" : "+";
                this.sectionStates["Custom"] = isHidden;
                this.savePluginData();
            }
        });

        const imageGrid = $el("div", { className: "neo-gallery-image-grid" });
        imageGrid.appendChild(this.createAddCustomImageButton());
        items.forEach(item => imageGrid.appendChild(this.createImageElement(item, "custom")));
        content.appendChild(imageGrid);

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    createImageElement(image, subfolder) {
        // Use preview data URI directly if available
        const src = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}`;

        // Determine if this is an image file (has aspect ratio) or non-image
        const isImageFile = /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i.test(image.filename);

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
                // width = height / aspectRatio = height * (width / height)
                container.style.width = `${Math.max(this.maxThumbnailSize * (1 / aspectRatio), 40)}px`;
            };
            img.src = src;
        }

        // Delete button (only for custom)
        let deleteBtn = null;
        if (subfolder === "custom") {
            deleteBtn = $el("div", {
                className: "neo-gallery-delete-btn",
                onclick: (e) => {
                    e.stopPropagation();
                    this.deleteItem(image.name, subfolder);
                }
            }, ["×"]);
        }

        // Send button (top-right)
        const sendBtn = $el("div", {
            className: "neo-gallery-thumb-send-btn",
            onclick: (e) => {
                e.stopPropagation();
                this.copyToClipboard(image.name, image.txt_content, sendBtn, 'send');
            }
        }, ["✈️"]);

        // Copy button (below send button)
        const copyBtn = $el("div", {
            className: "neo-gallery-thumb-copy-btn",
            onclick: (e) => {
                e.stopPropagation();
                this.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
            }
        }, ["⧉"]);

        const imgEl = $el("img", {
            className: "neo-gallery-thumb-img",
            src: src,
            alt: image.name,
            onerror: () => {
                if (!image.preview) imgEl.src = this.placeholderImageUrl;
            }
        });

        // Wrap image and buttons in a relative-positioned wrapper
        const imgWrapper = $el("div", {
            className: "neo-gallery-thumb-img-wrapper"
        }, [imgEl, sendBtn, copyBtn]);

        const labelEl = this.displayLabels ? $el("span", {
            className: "neo-gallery-image-label",
            textContent: image.name.replace(/\.\w+$/, '') // strip extension
        }) : null;

        if (deleteBtn) container.appendChild(deleteBtn);
        container.appendChild(imgWrapper);
        if (labelEl) container.appendChild(labelEl);

        // Tooltip with first segment of txt_content as summary
        if (image.txt_content) {
            container.title = this.getFirstSegment(image.txt_content);
        } else if (image.style) {
            container.title = image.style;
        }

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

    /**
     * Extract the first meaningful segment from text.
     */
    getFirstSegment(text) {
        if (!text) return "";
        const segments = text.split(/[。！？；:\n]+/).filter(s => s.trim());
        if (segments.length === 0) return "";
        let first = segments[0].trim();
        const colonIdx = first.indexOf('：');
        if (colonIdx > 0) {
            first = first.substring(colonIdx + 1).trim();
        }
        return first.length > 50 ? first.substring(0, 50) + '...' : first;
    }

    /**
     * Parse txt_content into structured sections for display.
     */
    parsePromptSections(txtContent) {
        if (!txtContent) return [];
        const rawSegments = txtContent.split(/[。！？；\n]+/).filter(s => s.trim());
        const sections = [];

        for (const rawSeg of rawSegments) {
            const trimmed = rawSeg.trim();
            if (!trimmed) continue;

            const fullColonMatch = trimmed.match(/^(.+?)[：](.*)$/s);
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
        if (this.allPresets.length === 0) {
            this.showToast('warning', 'No Presets', 'No presets available.');
            return;
        }
        const randomItem = this.allPresets[Math.floor(Math.random() * this.allPresets.length)];
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
        } else if (selectedValue && selectedValue !== "clipboard") {
            if (selectedValue.startsWith('prompt:')) {
                const nodeId = parseInt(selectedValue.split(':')[1]);
                targetNode = app.graph.getNodeById(nodeId);
                if (targetNode && targetNode._rsPromptUIElements) {
                    isPromptNode = true;
                    targetNodeIds.push(nodeId);
                }
            } else {
                const [nodeId, , index] = selectedValue.split(':');
                targetNode = app.graph.getNodeById(parseInt(nodeId));
                targetWidget = targetNode?.widgets?.[parseInt(index)];
                if (targetNode && targetNode._rsPromptUIElements) {
                    isPromptNode = true;
                    targetNodeIds.push(parseInt(nodeId));
                }
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
                this.showInlineFeedback(feedbackBtn, '✅ Sent!', 'success');
            } else {
                this.showToast('success', 'Tags Sent!', `Sent to ${targetNode.title || 'Node'}`);
            }
        } else if (targetNode && targetWidget) {
            targetWidget.value = textToCopy;
            if (targetNode.onWidgetChanged) targetNode.onWidgetChanged(targetWidget.name, targetWidget.value);
            app.graph.setDirtyCanvas(true, true);
            if (feedbackBtn) {
                this.showInlineFeedback(feedbackBtn, '✅ Sent!', 'success');
            } else {
                this.showToast('success', 'Tags Sent!', `Sent to ${targetNode.title} - ${targetWidget.name}`);
            }
        } else {
            navigator.clipboard.writeText(textToCopy).then(() => {
                if (feedbackBtn) {
                    const msg = actionType === 'send' ? '✅ Sent!' : '✅ Copied!';
                    this.showInlineFeedback(feedbackBtn, msg, 'success');
                } else {
                    this.showToast('success', actionType === 'send' ? 'Tags Sent!' : 'Tags Copied!', `Tags for "${imageName}" ${actionType === 'send' ? 'sent to' : 'copied to'} clipboard`);
                }
            }).catch(() => {
                if (feedbackBtn) {
                    this.showInlineFeedback(feedbackBtn, '❌ Failed', 'error');
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
        feedback.style.top = (top - 8) + 'px';
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
            $el("div", { className: "neo-gallery-no-files-message-icon", textContent: "📷" }),
            $el("p", { className: "neo-gallery-no-files-message-text", textContent: "No presets found. Add images + .txt files to gallery/presets/." })
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

        const imageUrl = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}`;
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
        }, ["×"]);

        const navBtns = $el("div", {
            className: "neo-gallery-lightbox-nav-btns"
        });

        const sendBtn = $el("div", {
            className: "neo-gallery-lightbox-btn neo-gallery-lightbox-send-btn",
            onclick: (e) => {
                e.stopPropagation();
                this.copyToClipboard(image.name, image.txt_content, sendBtn, 'send');
            }
        }, ["✈️ Send"]);

        const copyBtn = $el("div", {
            className: "neo-gallery-lightbox-btn neo-gallery-lightbox-copy-btn",
            onclick: (e) => {
                e.stopPropagation();
                this.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
            }
        }, ["⧉ Copy"]);

        imgWrapper.appendChild(img);

        const allImages = [
            ...this.allPresets.map(p => ({...p, subfolder: "presets"})).sort((a, b) => a.name.localeCompare(b.name)),
            ...this.allCustom.map(c => ({...c, subfolder: "custom"})).sort((a, b) => a.name.localeCompare(b.name))
        ];
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
        }, ["‹"]);
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
        }, ["›"]);
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
                                textContent: section.label + "："
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

        container.appendChild(imgWrapper);
        if (promptSection) container.appendChild(promptSection);
        container.appendChild(closeBtn);
        lightbox.appendChild(container);
        document.body.appendChild(lightbox);

        requestAnimationFrame(() => {
            navBtns.style.animation = "neoGallerySlideUp 0.4s ease-out 0.2s both";
        });

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
        const newImageUrl = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}`;

        if (img) {
            img.style.opacity = '0';
            img.style.transform = 'scale(1)';
            
            setTimeout(() => {
                img.src = newImageUrl;
                img.onload = () => {
                    img.style.opacity = '1';
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
                                textContent: section.label + "："
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
                        app.neoGallery.copyToClipboard(image.name, image.txt_content, sendBtn, 'send');
                    }
                }, ["✈️ Send"]);
                
                const copyBtn = $el("div", {
                    className: "neo-gallery-lightbox-btn neo-gallery-lightbox-copy-btn",
                    onclick: (e) => {
                        e.stopPropagation();
                        app.neoGallery.copyToClipboard(image.name, image.txt_content, copyBtn, 'copy');
                    }
                }, ["⧉ Copy"]);
                
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
        await this.loadGallery();
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
            type: "slider", attrs: { min: 150, max: 300, step: 25 }, defaultValue: 150,
            onChange: (val) => { if (app.neoGallery) app.neoGallery.updateThumbnailSize(val); }
        });

        app.ui.settings.addSetting({
            id: "Neo Gallery._General.displayLabels",
            name: "Neo Gallery Display Image Labels",
            type: "boolean", defaultValue: true,
            onChange: (val) => { if (app.neoGallery) app.neoGallery.updateLabelDisplay(val); }
        });

        app.extensionManager.registerSidebarTab({
            id: "neo.gallery",
            icon: "pi pi-id-card",
            title: "Neo Gallery",
            tooltip: "Neo Gallery",
            type: "custom",
            render: (el) => {
                // Clear the container first to prevent gallery content from being appended below other panel content
                el.innerHTML = "";
                
                if (!gallery.element.parentNode) {
                    el.appendChild(gallery.element);
                } else {
                    // Move gallery element to this container (appendChild moves it from old parent automatically)
                    el.appendChild(gallery.element);
                }
            },
        });
    },
});
