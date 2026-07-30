import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { $el } from "../../../../scripts/ui.js";

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

        this.element = $el("div", {
            style: {
                padding: "10px 10px 20px 10px",
                backgroundColor: "#1a1a1a",
                minHeight: "400px"
            }
        }, [
            $el("h3", { textContent: "Neo Gallery", style: { marginBottom: "10px", color: "#eee" }}),
            $el("div", { style: { display: "flex", gap: "8px", marginBottom: "10px", alignItems: "stretch" } }, [
                $el("div", { style: { flex: 1 } }, [this.searchInput]),
                $el("div", { style: { width: "180px", flexShrink: 0 } }, [this.targetNodeDropdown])
            ]),
            this.accordion,
            // Thumbnail Size - at bottom of panel
            $el("div", {
                style: {
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "10px",
                    padding: "6px 10px",
                    backgroundColor: "rgba(42, 42, 42, 0.9)",
                    borderRadius: "4px"
                }
            }, [
                $el("span", { textContent: "Size:", style: { fontSize: "11px", color: "#999" } }),
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

    // Removed createUseSelectedNodeCheckbox - now integrated into dropdown

    createTargetNodeDropdown() {
        const dropdown = $el("select", {
            id: "target-node-dropdown",
            style: {
                width: "100%",
                padding: "6px 10px",
                borderRadius: "4px",
                border: "1px solid #444",
                backgroundColor: "#2a2a2a",
                color: "white",
                fontSize: "12px",
                textOverflow: "ellipsis",
                outline: "none",
                boxSizing: "content-box",
                height: "30px"
            },
            title: "Target for prompt insertion: where the gallery prompt will be sent"
        });

        // Placeholder option
        dropdown.appendChild($el("option", {
            value: "",
            textContent: "Select prompt target...",
            style: { color: "#999" }
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
            style: {
                width: "100%",
                padding: "6px 10px",
                borderRadius: "4px",
                border: "1px solid #444",
                backgroundColor: "#2a2a2a",
                color: "white",
                fontSize: "12px",
                outline: "none",
                boxSizing: "content-box",
                height: "30px"
            }
        });
        input.addEventListener("input", this.debounce(() => this.handleSearch(input.value), 300));
        return input;
    }

    createThumbnailSizeSlider() {
        const valueLabel = $el("span.thumbnail-size-value", {
            textContent: `${this.maxThumbnailSize}px`,
            style: { fontSize: "11px", color: "#999", minWidth: "40px", textAlign: "right" }
        });

        const slider = $el("input", {
            type: "range",
            min: 50,
            max: 250,
            step: 25,
            value: this.maxThumbnailSize,
            style: { width: "100px", cursor: "pointer", height: "16px" },
            onchange: () => {
                const val = parseInt(slider.value);
                this.updateThumbnailSize(val);
                valueLabel.textContent = `${val}px`;
                this.savePluginData({ maxThumbnailSize: val });
            }
        });

        return $el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, [slider, valueLabel]);
    }

    createAddCustomImageButton() {
        return $el("div", {
            style: {
                width: `${this.maxThumbnailSize}px`,
                height: `${this.maxThumbnailSize}px`,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                cursor: "pointer",
                border: "2px dashed #ccc",
                borderRadius: "5px",
                backgroundColor: "#2a2a2a"
            },
            onclick: () => this.showAddCustomImageDialog()
        }, [
            $el("div", { textContent: "+", style: { fontSize: `${Math.max(20, this.maxThumbnailSize / 3)}px`, color: "#ccc" }}),
            $el("div", { textContent: "Add", style: { marginTop: "5px", fontSize: `${Math.max(12, this.maxThumbnailSize / 8)}px`, color: "#ccc" }})
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
                style: { display: "flex", flexDirection: "column", alignItems: "center", height: "200px", justifyContent: "center", backgroundColor: "#1a1a1a", borderRadius: "8px", border: "1px solid #333" }
            }, [
                $el("div", { textContent: "😔", style: { fontSize: "64px", color: "#666", marginBottom: "20px" }}),
                $el("div", { textContent: "No matching images found", style: { fontSize: "18px", color: "#aaa" }})
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
            className: `accordion-section ${title.toLowerCase()}`,
            style: { marginBottom: "10px" }
        });

        const header = $el("div.accordion-header", {
            style: { cursor: "pointer", padding: "10px", backgroundColor: "#2a2a2a", borderRadius: "4px", marginBottom: "5px", display: "flex", justifyContent: "space-between", alignItems: "center" }
        });

        const headerText = $el("span", { textContent: `${title} (${items.length})` });
        const indicator = $el("span", { textContent: this.sectionStates[title] ? "-" : "+", style: { fontSize: "18px", fontWeight: "bold" }});

        // Add small Random Prompt button for Presets section
        if (title === "Presets" && items.length > 0) {
            const randomBtn = $el("button", {
                textContent: "🎲",
                onclick: (e) => {
                    e.stopPropagation();
                    this.generateRandomPrompt();
                },
                style: {
                    padding: "4px 8px",
                    backgroundColor: "transparent",
                    color: "#FF6A00",
                    border: "1px solid #FF6A00",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                    lineHeight: "1",
                    marginLeft: "10px"
                },
                title: "Random Prompt"
            });
            header.appendChild(randomBtn);
        }

        header.appendChild(headerText);
        header.appendChild(indicator);

        const content = $el("div.accordion-content", {
            style: {
                display: this.sectionStates[title] ? "flex" : "none",
                flexDirection: "column", gap: "10px", padding: "10px", backgroundColor: "#1a1a1a", borderRadius: "4px"
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

        const imageGrid = $el("div", { style: { display: "flex", flexWrap: "wrap", gap: "10px", width: "100%" }});
        items.forEach(item => imageGrid.appendChild(this.createImageElement(item, subfolder)));
        content.appendChild(imageGrid);

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    createCustomSection(items) {
        const section = $el("div", { className: "accordion-section custom-section", style: { marginBottom: "10px" }});

        const header = $el("div.accordion-header", {
            style: { cursor: "pointer", padding: "10px", backgroundColor: "#2a2a2a", borderRadius: "4px", marginBottom: "5px", display: "flex", justifyContent: "space-between", alignItems: "center" }
        });

        const headerText = $el("span", { textContent: `Custom (${items.length})` });
        const indicator = $el("span", { textContent: this.sectionStates["Custom"] ? "-" : "+", style: { fontSize: "18px", fontWeight: "bold" }});

        // Add small "Clear All Custom" button for Custom section
        if (items.length > 0) {
            const clearBtn = $el("button", {
                textContent: "🗑️",
                onclick: (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete all ${items.length} custom images? This cannot be undone.`)) {
                        for (const item of items) {
                            this.deleteItem(item.name, "custom");
                        }
                    }
                },
                style: {
                    padding: "4px 8px",
                    backgroundColor: "transparent",
                    color: "#f44336",
                    border: "1px solid #f44336",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                    lineHeight: "1",
                    marginLeft: "10px"
                },
                title: "Clear All Custom"
            });
            header.appendChild(clearBtn);
        }

        header.appendChild(headerText);
        header.appendChild(indicator);

        const content = $el("div.accordion-content", {
            style: {
                display: this.sectionStates["Custom"] ? "flex" : "none",
                flexDirection: "column", gap: "10px", padding: "10px", backgroundColor: "#1a1a1a", borderRadius: "4px"
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

        const imageGrid = $el("div", { style: { display: "flex", flexWrap: "wrap", gap: "10px", width: "100%" }});
        imageGrid.appendChild(this.createAddCustomImageButton());
        items.forEach(item => imageGrid.appendChild(this.createImageElement(item, "custom")));
        content.appendChild(imageGrid);

        // Clear All button is now only in the header, no duplicate button here

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    createImageElement(image, subfolder) {
        // Use preview data URI directly if available
        const src = image.preview || `${window.location.protocol}//${window.location.host}/neo_gallery/image?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(subfolder)}`;

        const container = $el("div", {
            style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                cursor: "pointer",
                width: `${this.maxThumbnailSize}px`,
                height: this.displayLabels ? `${this.maxThumbnailSize + 40}px` : `${this.maxThumbnailSize}px`,
                overflow: "hidden",
                position: "relative"
            },
            onclick: () => this.copyToClipboard(image.name, image.txt_content)
        });

        // Delete button (only for custom)
        let deleteBtn = null;
        if (subfolder === "custom") {
            deleteBtn = $el("div", {
                style: { position: "absolute", top: "2px", right: "2px", background: "rgba(244,67,54,0.9)", color: "white", border: "none", borderRadius: "50%", width: "24px", height: "24px", fontSize: "14px", lineHeight: "24px", textAlign: "center", cursor: "pointer", zIndex: "10" },
                onclick: (e) => {
                    e.stopPropagation();
                    this.deleteItem(image.name, subfolder);
                }
            }, ["×"]);
        }

        const imgEl = $el("img", {
            src: src,
            style: { width: `${this.maxThumbnailSize}px`, height: `${this.maxThumbnailSize}px`, objectFit: "cover", borderRadius: "5px" },
            alt: image.name,
            onerror: () => {
                if (!image.preview) imgEl.src = this.placeholderImageUrl;
            }
        });

        const labelEl = this.displayLabels ? $el("span", {
            textContent: image.name.replace(/\.\w+$/, ''), // strip extension
            style: { marginTop: "5px", fontSize: "12px", textAlign: "center", width: "100%", overflow: "hidden", textOverflow: "ellipsis" }
        }) : null;

        if (deleteBtn) container.appendChild(deleteBtn);
        container.appendChild(imgEl);
        if (labelEl) container.appendChild(labelEl);

        // Tooltip with style description
        if (image.style) {
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

    copyToClipboard(imageName, txtContent) {
        let textToCopy = String(txtContent || "").trim();
        textToCopy = this.cleanText(textToCopy);

        const selectedValue = document.getElementById("target-node-dropdown")?.value;

        // Check if target is a prompts.js node (NeoPromptEncoder or NeoPromptGenerator)
        let targetNodeIds = [];
        let isPromptNode = false;
        let targetNode = null;
        let targetWidget = null;

        // Handle Active Selection (value: "selected")
        if (selectedValue === "selected") {
            const selectedKeys = Object.keys(app.canvas.selected_nodes);
            if (selectedKeys.length > 0) {
                targetNode = app.canvas.selected_nodes[selectedKeys[0]];
                // Check if it's a prompts.js node
                if (targetNode && targetNode._rsPromptUIElements) {
                    isPromptNode = true;
                    targetNodeIds.push(parseInt(selectedKeys[0]));
                }
                // Find first text widget if not a prompts.js node
                if (!isPromptNode && targetNode) {
                    targetWidget = targetNode.widgets?.find(w => ['string', 'text', 'customtext'].includes(w.type));
                }
            }
        } else if (selectedValue && selectedValue !== "clipboard") {
            // Check if it's a prompts.js node (format: "prompt:nodeId")
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
                // Check if it's a prompts.js node
                if (targetNode && targetNode._rsPromptUIElements) {
                    isPromptNode = true;
                    targetNodeIds.push(parseInt(nodeId));
                }
            }
        }

        // Handle prompts.js nodes (NeoPromptEncoder / NeoPromptGenerator)
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
            this.showToast('success', 'Tags Sent!', `Sent to ${targetNode.title || 'Node'}`);
        } else if (targetNode && targetWidget) {
            targetWidget.value = textToCopy;
            if (targetNode.onWidgetChanged) targetNode.onWidgetChanged(targetWidget.name, targetWidget.value);
            app.graph.setDirtyCanvas(true, true);
            this.showToast('success', 'Tags Sent!', `Sent to ${targetNode.title} - ${targetWidget.name}`);
        } else {
            navigator.clipboard.writeText(textToCopy).then(() => {
                this.showToast('success', 'Tags Copied!', `Tags for "${imageName}" copied to clipboard`);
            }).catch(() => {
                this.showToast('error', 'Copy Failed', `Failed to copy tags`);
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

    displayNoFilesMessage() {
        this.accordion.appendChild($el("div", {
            style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", minHeight: "200px", padding: "20px", margin: "20px 0" }
        }, [
            $el("div", { textContent: "📷", style: { fontSize: "48px", color: "#888", marginBottom: "15px" }}),
            $el("p", { textContent: "No presets found. Add images + .txt files to gallery/presets/.", style: { fontSize: "18px", color: "#888" }})
        ]));
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
            type: "slider", attrs: { min: 50, max: 250, step: 25 }, defaultValue: 100,
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
                el.appendChild(gallery.element);
            },
        });
    },
});