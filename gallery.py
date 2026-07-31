# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes — Gallery Module (preset-based: image + .txt by same name)

import os
import re
import json
import base64
from pathlib import Path
from aiohttp import web
from server import PromptServer
import mimetypes

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
CURRENT_DIR = Path(__file__).parent.resolve()
GALLERY_DIR = CURRENT_DIR / "gallery"
PRESETS_DIR = GALLERY_DIR / "presets"
CUSTOM_DIR = GALLERY_DIR / "custom"

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"}


def _get_user_custom_dirs():
    """Get all user-configured custom directory paths from settings.
    
    Returns a list of Path objects for each configured directory.
    Expects an array of absolute filesystem paths in "custom_directories" key.
    Falls back to legacy single "custom_directory" for backward compatibility.
    """
    dirs = []
    try:
        settings_path = CURRENT_DIR / "gallery_settings.json"
        if settings_path.exists():
            with open(settings_path, "r") as f:
                settings = json.load(f)
                # New format: array of directories
                user_dirs = settings.get("custom_directories", [])
                if isinstance(user_dirs, list):
                    for d in user_dirs:
                        if d and Path(d).exists():
                            dirs.append(Path(d))
                elif user_dirs:
                    # Legacy single directory (backward compat)
                    p = Path(user_dirs) if isinstance(user_dirs, str) else None
                    if p and p.exists():
                        dirs.append(p)
    except Exception:
        pass
    return dirs


def _get_presets_dir():
    """Get presets directory path (always the default PRESETS_DIR)."""
    return PRESETS_DIR


def _ensure_dirs() -> None:
    for d in (GALLERY_DIR, PRESETS_DIR, CUSTOM_DIR):
        d.mkdir(parents=True, exist_ok=True)

 
def _parse_txt(raw_txt: str) -> dict:
    """Parse an 8-line structured txt (with optional line-number prefix like '1 | ').

    Returns dict with style, elements, content, composition, lighting, materials, anatomy, pose, txt_content.
    """
    cleaned: list[str] = [""] * 8
    if raw_txt:
        try:
            lines = raw_txt.strip().splitlines()
            for i, line in enumerate(lines):
                if i >= 8:
                    break
                m = re.match(r"^\d+\s*\|\s*(.*)", line)
                cleaned[i] = m.group(1) if m else line
        except Exception:
            pass

    style, elements, content, composition, lighting, materials, anatomy, pose = (
        cleaned[0], cleaned[1], cleaned[2], cleaned[3],
        cleaned[4], cleaned[5], cleaned[6], cleaned[7],
    )

    display_style = ""
    if "：" in style:
        display_style = style.split("：")[-1].strip()
    elif ":" in style:
        display_style = style.split(":")[-1].strip()
    else:
        display_style = style.strip()

    txt_content = "\n".join(cleaned).strip() if cleaned else ""

    return {
        "style": display_style,
        "elements": elements,
        "content": content,
        "composition": composition,
        "lighting": lighting,
        "materials": materials,
        "anatomy": anatomy,
        "pose": pose,
        "txt_content": txt_content,
    }


def _make_entry(image_path: Path, txt_path: Path, raw_txt: str) -> dict | None:
    """Build a gallery entry dict from image + txt paths.
    
    Note: preview data is NOT included here to keep API responses small.
    The frontend fetches images via /neo_gallery/image endpoint instead.
    """
    fields = _parse_txt(raw_txt)
    # Don't include preview in listing - let frontend fetch via URL
    
    return {
        "name": image_path.stem,
        "filename": image_path.name,
        "txt_file": txt_path.name,
        **fields,
    }


def _scan_gallery_entries(directory: Path) -> list[dict]:
    """Walk directory recursively and return gallery entries.

    Strategy: group files by stem (relative to directory). An image + sibling .txt = valid preset.
    Subdirectories become the 'category' field in each entry.
    Files directly in the root get category='' (empty string).
    """
    entries: list[dict] = []
    if not directory.exists():
        return entries

    stems: dict[tuple[str, str], list[Path]] = {}  # key: (category, stem) -> [Path]
    for p in directory.rglob("*"):
        if not p.is_file():
            continue
        lower = p.suffix.lower()
        if lower not in IMG_EXTENSIONS and lower != ".txt":
            continue

        rel = p.relative_to(directory)
        parts = rel.parts
        category = ""
        if len(parts) > 1:
            # Subdirectory name(s) — use the first part as category
            category = parts[0]

        stems.setdefault((category, p.stem), []).append(p)

    for (category, stem), files in sorted(stems.items()):
        image_file = None
        txt_file = None
        for f in files:
            if f.suffix.lower() in IMG_EXTENSIONS:
                image_file = f
            elif f.suffix.lower() == ".txt":
                txt_file = f

        if not image_file:
            continue

        txt_path = txt_file if txt_file else (image_file.with_suffix(".txt"))
        raw_txt = ""
        if txt_path.exists():
            try:
                raw_txt = txt_path.read_text(encoding="utf-8")
            except Exception:
                raw_txt = ""

        entry = _make_entry(image_file, txt_path, raw_txt)
        if entry:
            entry["category"] = category
            entries.append(entry)

    return entries


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/neo_gallery/list")
async def get_gallery_list(request):
    """Return gallery listing (custom_dirs grouped by name + presets)."""
    user_custom_dirs = _get_user_custom_dirs()
    presets = _scan_gallery_entries(PRESETS_DIR)

    # Scan all user-configured directories, group by directory name
    custom_dir_groups = {}  # dir_name -> {"name": ..., "path": ..., "items": [...]}
    for dir_path in user_custom_dirs:
        dir_name = dir_path.name if dir_path.name else str(dir_path)
        entries = _scan_gallery_entries(dir_path)
        for entry in entries:
            entry["custom_source"] = dir_name  # tag to identify source directory
        custom_dir_groups[dir_name] = {
            "name": dir_name,
            "path": str(dir_path),
            "items": entries
        }

    return web.json_response({
        "custom_dirs": list(custom_dir_groups.values()),
        "presets": presets,
        "total": sum(len(g["items"]) for g in custom_dir_groups.values()) + len(presets)
    })



CURRENT_WEB_DIR = CURRENT_DIR / "web"

# Minimal 1x1 transparent PNG as placeholder
_PLACEHOLDER_PNG = bytes([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
    0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
])


@PromptServer.instance.routes.get("/neo_gallery/css")
async def serve_css(request):
    """Serve gallery CSS file."""
    css_path = CURRENT_WEB_DIR / "gallery.css"
    if css_path.exists():
        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()
        return web.Response(text=css_content, content_type="text/css")
    return web.Response(status=404)


@PromptServer.instance.routes.get("/neo_gallery/placeholder.png")
async def serve_placeholder(request):
    """Serve a minimal placeholder image."""
    return web.Response(body=_PLACEHOLDER_PNG, content_type="image/png")


@PromptServer.instance.routes.get("/neo_gallery/resolve_path")
async def resolve_comfyui_path(request):
    """Resolve ComfyUI's built-in input/output directory paths.
    
    Query params:
    - path_type: 'input' or 'output'
    
    Returns the absolute filesystem path that ComfyUI uses for these directories.
    """
    path_type = request.rel_url.query.get("path_type", "").lower()
    
    if path_type not in ("input", "output"):
        return web.json_response({"success": False, "error": "Invalid path_type"}, status=400)
    
    try:
        # Import folder_paths to get the actual ComfyUI directory paths
        import folder_paths as _folder_paths
        
        if path_type == "input":
            base_dir = _folder_paths.input_directory
        else:  # output
            base_dir = _folder_paths.output_directory
        
        # Validate the resolved path exists and is within expected bounds
        resolved_path = Path(base_dir).resolve()
        if not resolved_path.exists():
            return web.json_response({
                "success": False, 
                "error": f"Directory does not exist: {resolved_path}"
            }, status=404)
        
        # Security check: ensure path is within reasonable bounds (not parent of ComfyUI root)
        comfy_root = Path(__file__).parent.parent.parent.resolve()  # ComfyUI/
        if not str(resolved_path).startswith(str(comfy_root)):
            return web.json_response({
                "success": False, 
                "error": f"Path outside ComfyUI directory: {resolved_path}"
            }, status=400)
        
        return web.json_response({
            "success": True,
            "path": str(resolved_path),
            "display_name": resolved_path.name
        })
    except Exception as e:
        print(f"[Neo Gallery] Error resolving {path_type} path: {e}")
        return web.json_response({
            "success": False, 
            "error": f"Failed to resolve {path_type} directory: {str(e)}"
        }, status=500)


def _scan_directory_structure(directory: Path, base_dir: Path) -> dict:
    """Scan directory and return hierarchical structure of subdirectories.
    
    Returns a dict with:
    - 'subdirs': list of subdirectory names (only direct children)
    - 'images': list of image entries at this level (files directly in this dir, not in subdirs)
    """
    if not directory.exists():
        return {"subdirs": [], "images": []}
    
    # Collect all items recursively first
    all_entries = _scan_gallery_entries(directory)
    
    # Group by category (first-level subdir name)
    subdir_map = {}  # subdir_name -> list of entries
    
    for entry in all_entries:
        cat = entry.get("category", "")
        if cat:
            if cat not in subdir_map:
                subdir_map[cat] = []
            subdir_map[cat].append(entry)
    
    subdirs = sorted(subdir_map.keys())
    
    # Images at root level (no category)
    images = [e for e in all_entries if not e.get("category")]
    
    return {
        "subdirs": subdirs,
        "images": images,
        "has_subdirs": len(subdirs) > 0,
        "image_count": len(images),
        "total_images": len(all_entries)
    }


@PromptServer.instance.routes.get("/neo_gallery/dir_structure")
async def get_directory_structure(request):
    """Get hierarchical directory structure for a given path.
    
    Query params:
    - dir_name: name of the custom directory or 'presets' (required)
    - path: relative subdirectory path within that directory (optional, "/" separated)
    """
    if "dir_name" not in request.rel_url.query:
        return web.json_response({"error": "Missing dir_name"}, status=400)
    
    dir_name = request.rel_url.query["dir_name"]
    rel_path = request.rel_url.query.get("path", "")
    
    # Security check for path traversal
    if ".." in rel_path:
        return web.json_response({"error": "Invalid path"}, status=400)
    
    # Handle presets as a special directory
    if dir_name == "presets":
        base = PRESETS_DIR
    else:
        # Find the custom directory
        user_custom_dirs = _get_user_custom_dirs()
        for dir_path in user_custom_dirs:
            d_name = dir_path.name if dir_path.name else str(dir_path)
            if d_name == dir_name:
                base = dir_path
                break
    
    if not base or not base.exists():
        return web.json_response({"error": "Directory not found"}, status=404)
    
    # Construct full path with relative subdirectory
    if rel_path:
        parts = [p for p in rel_path.split("/") if p]  # filter empty strings
        target_dir = base
        for part in parts:
            target_dir = target_dir / part
    else:
        target_dir = base
    
    structure = _scan_directory_structure(target_dir, base)
    
    return web.json_response({
        "dir_name": dir_name,
        "path": rel_path,
        **structure
    })


@PromptServer.instance.routes.get("/neo_gallery/image")
async def view_image(request):
    """Serve gallery images by filename."""
    if "filename" not in request.rel_url.query:
        return web.Response(status=400)

    filename = request.rel_url.query["filename"]
    subfolder = request.rel_url.query.get("subfolder", "presets")
    category = request.rel_url.query.get("category", "")

    if ".." in filename or ".." in subfolder:
        return web.Response(status=400)

    # Determine base directory based on subfolder
    if subfolder.startswith("__"):
        return web.Response(status=400)

    # Find the matching custom_dir_groups entry by name, or use built-in dirs
    user_custom_dirs = _get_user_custom_dirs()
    base = None
    
    # Handle hierarchical paths like "ningyao3D/26-06-26"
    dir_parts = [p for p in subfolder.split("/") if p]
    
    def _match_dir_name(parts_list):
        """Match directory name against user_custom_dirs by checking the last component of each path."""
        target = parts_list[0]
        for dir_path in user_custom_dirs:
            # Match against the last component (e.g., "ningyao3D" from full path)
            if dir_path.name == target:
                return dir_path
        return None
    
    if len(dir_parts) > 1:
        # First part is the directory name, rest are subdirectories
        matched_dir = _match_dir_name(dir_parts)
        if matched_dir:
            base = matched_dir / "/".join(dir_parts[1:])
    elif subfolder in ("presets", "custom"):
        if subfolder == "presets":
            base = PRESETS_DIR
        else:
            base = CUSTOM_DIR
    else:
        # Try to find as custom directory name
        for dir_path in user_custom_dirs:
            d_name = dir_path.name if dir_path.name else str(dir_path)
            if subfolder == d_name:
                base = dir_path
                break

    if not base or not base.exists():
        return web.Response(status=404)

    # Check category subdirectory first, then fall back to root
    fullpath = None
    
    # Determine the stem (filename without extension) for matching
    from pathlib import PurePath as _PurePath
    _p = _PurePath(filename)
    file_stem = _p.stem  # e.g. "001" from "001.png"
    
    checked_paths = set()
    
    # Build list of candidate filenames to try
    candidates_to_try = [filename]  # Full filename first (e.g., "001.png")
    for ext in [".jpeg", ".jpg", ".png", ".webp", ".gif", ".bmp", ".tiff"]:
        candidates_to_try.append(file_stem + ext)
    
    for candidate_filename in candidates_to_try:
        if candidate_filename in checked_paths:
            continue
        
        # Try with category first
        if category:
            candidate = base / category / candidate_filename
            if candidate.exists():
                fullpath = candidate
                checked_paths.add(str(candidate))
                break
        
        # Also check root level (fallback)
        if not fullpath:
            candidate = base / candidate_filename
            if candidate.exists():
                fullpath = candidate
                checked_paths.add(str(candidate))
                break
    
    # Final fallback: scan the entire base directory recursively for matching stem
    if fullpath is None:
        for p in base.rglob(f"{file_stem}*"):
            if p.is_file() and str(p) not in checked_paths:
                ext_lower = p.suffix.lower()
                if ext_lower in IMG_EXTENSIONS:
                    fullpath = p
                    break

    if fullpath and fullpath.exists():
        with open(fullpath, "rb") as f:
            content = f.read()
        content_type, _ = mimetypes.guess_type(str(fullpath))
        if not content_type:
            content_type = "application/octet-stream"
        return web.Response(
            body=content,
            content_type=content_type,
            headers={"Content-Disposition": f'inline; filename="{fullpath.name}"'},
        )
    return web.Response(status=404)


@PromptServer.instance.routes.post("/neo_gallery/upload")
async def upload_image(request):
    """Upload custom gallery images to gallery/custom/."""
    try:
        post = await request.post()
        image = post.get("image")
        if not image or not image.file:
            return web.json_response({"error": "No image file provided"}, status=400)

        filename = image.filename or "upload.jpg"
        filename = os.path.basename(filename)
        if ".." in filename or "/" in filename:
            return web.json_response({"error": "Invalid filename"}, status=400)

        dest = CUSTOM_DIR / filename
        with open(dest, "wb") as f:
            import shutil
            shutil.copyfileobj(image.file, f)

        return web.json_response({"name": filename, "success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ---------------------------------------------------------------------------
# Settings Routes (custom presets directory)
# ---------------------------------------------------------------------------

SETTINGS_FILE = CURRENT_DIR / "gallery_settings.json"


def _save_settings(settings: dict):
    """Save settings to gallery_settings.json."""
    try:
        with open(SETTINGS_FILE, "w") as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        print(f"[Neo Gallery] Failed to save settings: {e}")


def _load_settings() -> dict:
    """Load settings from gallery_settings.json."""
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"[Neo Gallery] Failed to load settings: {e}")
    return {}


@PromptServer.instance.routes.post("/neo_gallery/save_settings")
async def save_gallery_settings(request):
    """Save gallery settings (custom directories list).
    
    Supports both legacy single directory and new array format.
    New format: {"custom_directories": ["path1", "path2"]}
    Legacy format: {"custom_directory": "path"} (will be migrated)
    Actions: {"action": "add|remove|list", ...}
    """
    try:
        data = await request.json()
        current_settings = _load_settings()
        
        action = data.get("action")
        
        if action == "add":
            # Add a new directory to the list
            new_dir = data.get("path", "").strip()
            if not new_dir:
                return web.json_response({"success": False, "error": "No path provided"}, status=400)
            if not Path(new_dir).exists():
                return web.json_response(
                    {"success": False, "error": f"Directory not found: {new_dir}"}, 
                    status=400
                )
            # Get or create directories list
            dirs = current_settings.get("custom_directories", [])
            if new_dir not in dirs:
                dirs.append(new_dir)
            current_settings["custom_directories"] = dirs
            # Migrate legacy key if exists
            current_settings.pop("custom_directory", None)
            
        elif action == "remove":
            # Remove a directory from the list
            remove_path = data.get("path", "").strip()
            dirs = current_settings.get("custom_directories", [])
            if remove_path in dirs:
                dirs.remove(remove_path)
            current_settings["custom_directories"] = dirs
            
        elif action == "list":
            # Just return the list, no changes
            pass
            
        else:
            # Legacy single directory handling (backward compat)
            custom_dir = None
            if "presets_directory" in data:
                custom_dir = data["presets_directory"].strip()
            elif "custom_directory" in data:
                custom_dir = data["custom_directory"]
            
            if custom_dir is not None:
                if custom_dir and not Path(custom_dir).exists():
                    return web.json_response(
                        {"success": False, "error": f"Directory not found: {custom_dir}"}, 
                        status=400
                    )
                # Migrate to array format
                current_settings["custom_directories"] = [custom_dir]
                current_settings.pop("custom_directory", None)
        
        _save_settings(current_settings)
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/neo_gallery/get_settings")
async def get_gallery_settings(request):
    """Get gallery settings."""
    return web.json_response(_load_settings())


@PromptServer.instance.routes.post("/neo_gallery/upload_txt")
async def upload_txt(request):
    """Upload / update a .txt metadata file alongside a preset image."""
    try:
        post = await request.post()
        txt_content = post.get("content", "")
        filename = post.get("filename", "")

        if not filename:
            return web.json_response({"error": "No filename provided"}, status=400)

        if not filename.endswith(".txt"):
            filename += ".txt"

        dest = PRESETS_DIR / filename
        dest.write_text(txt_content, encoding="utf-8")
        return web.json_response({"name": filename, "success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.delete("/neo_gallery/delete")
async def delete_gallery_item(request):
    """Delete a preset or custom image + its .txt companion."""
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "presets")

        if ".." in filename or not filename:
            return web.json_response({"error": "Invalid filename"}, status=400)

        # Try to find the base directory
        user_custom_dirs = _get_user_custom_dirs()
        base = None
        
        # Check custom directories first
        for dir_path in user_custom_dirs:
            dir_name = dir_path.name if dir_path.name else str(dir_path)
            if subfolder == dir_name:
                base = dir_path
                break
        
        if not base and subfolder == "presets":
            base = PRESETS_DIR
        elif not base and subfolder == "custom":
            base = CUSTOM_DIR

        if not base or not base.exists():
            return web.json_response({"error": "Directory not found"}, status=404)

        img_deleted = False
        txt_deleted = False

        # Delete image
        for ext in IMG_EXTENSIONS:
            p = base / f"{filename}{ext}"
            if p.exists():
                p.unlink()
                img_deleted = True

        # Delete companion .txt
        txt = base / f"{filename}.txt"
        if txt.exists():
            txt.unlink()
            txt_deleted = True

        # Also try deleting by stem
        stem_path = base / filename
        if stem_path.exists() and stem_path.suffix.lower() == ".txt":
            stem_path.unlink()
            txt_deleted = True

        return web.json_response({"deleted": img_deleted or txt_deleted})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
