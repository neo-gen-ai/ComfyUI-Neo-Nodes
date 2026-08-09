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
THUMBNAIL_DIR = GALLERY_DIR / "thumbnails"
THUMBNAIL_SIZE = 320  # Fixed thumbnail size in pixels

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".flv", ".wmv"}
ALL_MEDIA_EXTENSIONS = IMG_EXTENSIONS | VIDEO_EXTENSIONS


def _get_user_custom_dirs():
    """Get all user-configured custom directory paths from settings."""
    dirs = []
    try:
        settings_path = CURRENT_DIR / "gallery_settings.json"
        if settings_path.exists():
            with open(settings_path, "r") as f:
                settings = json.load(f)
                user_dirs = settings.get("custom_directories", [])
                if isinstance(user_dirs, list):
                    for d in user_dirs:
                        if d and Path(d).exists():
                            dirs.append(Path(d))
                elif user_dirs:
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
    for d in (GALLERY_DIR, PRESETS_DIR, CUSTOM_DIR, THUMBNAIL_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _parse_txt(raw_txt: str) -> dict:
    """Parse an 8-line structured txt."""
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
    """Build a gallery entry dict from image + txt paths."""
    fields = _parse_txt(raw_txt)
    return {
        "name": image_path.stem,
        "filename": image_path.name,
        "txt_file": txt_path.name,
        **fields,
    }


def _scan_directory_summary(directory: Path) -> dict:
    """Lightweight directory scan - only returns structure, no file content.
    
    Returns:
        {
            "root_count": int,
            "subdirs": {name: {"image_count": int, "has_subdirs": bool}}
        }
    """
    result = {"root_count": 0, "subdirs": {}}
    if not directory.exists():
        return result

    # Count root-level images
    for p in directory.iterdir():
        if p.is_file() and p.suffix.lower() in IMG_EXTENSIONS:
            result["root_count"] += 1

    # Scan subdirectories
    for p in directory.iterdir():
        if not p.is_dir():
            continue
        subdir_count = 0
        has_nested = False
        for sub_p in p.iterdir():
            if sub_p.is_file() and sub_p.suffix.lower() in IMG_EXTENSIONS:
                subdir_count += 1
            elif sub_p.is_dir():
                has_nested = True
        result["subdirs"][p.name] = {
            "image_count": subdir_count,
            "has_subdirs": has_nested
        }

    return result


def _scan_directory_structure_only(directory: Path) -> dict:
    """Scan directory and return only structure (subdirectories with counts), no image entries.
    
    This is the fastest possible scan, used for lazy loading.
    Returns:
        {
            "root_count": int,
            "subdirs": {name: {"image_count": int, "has_subdirs": bool, "path": str}}
        }
    """
    result = {"root_count": 0, "subdirs": {}}
    if not directory.exists():
        return result

    # Count root-level images
    for p in directory.iterdir():
        if p.is_file() and p.suffix.lower() in IMG_EXTENSIONS:
            result["root_count"] += 1

    # Scan subdirectories - only structure, no file content
    for p in sorted(directory.iterdir()):
        if not p.is_dir():
            continue
        subdir_count = 0
        has_nested = False
        for sub_p in p.iterdir():
            if sub_p.is_file() and sub_p.suffix.lower() in IMG_EXTENSIONS:
                subdir_count += 1
            elif sub_p.is_dir():
                has_nested = True
        result["subdirs"][p.name] = {
            "image_count": subdir_count,
            "has_subdirs": has_nested,
            "path": p.name
        }

    return result


def _scan_gallery_entries_paged(directory: Path, page: int = 1, page_size: int = 50) -> dict:
    """Scan directory with pagination support.
    
    Returns paginated results to avoid loading too many entries at once.
    """
    entries = _scan_gallery_entries(directory)
    total = len(entries)
    start = (page - 1) * page_size
    end = start + page_size
    paged_entries = entries[start:end]
    
    return {
        "entries": paged_entries,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": end < total
    }


def _scan_gallery_entries(directory: Path, subfolder: str = "") -> list[dict]:
    """Scan directory (non-recursive) and return gallery entries.
    
    Supports both image and video files, paired with .txt by same stem.
    The 'filename' field always contains the media filename, not .txt.
    Video entries have 'type': 'video', image entries have 'type': 'image'.
    
    Args:
        directory: The directory to scan.
        subfolder: Optional relative path from the custom directory root.
            Used to set the 'subfolder' field for correct thumbnail URL resolution.
    """
    entries: list[dict] = []
    if not directory.exists():
        return entries

    # Determine category and subfolder from the subfolder parameter
    # When subfolder is provided, we're scanning a specific subdirectory,
    # so don't use subfolder name as category (that would group all entries under it)
    category = ""

    stems: dict[str, list[Path]] = {}
    for p in directory.iterdir():
        if not p.is_file():
            continue
        lower = p.suffix.lower()
        # Track media files and .txt files by stem
        if lower not in ALL_MEDIA_EXTENSIONS and lower != ".txt":
            continue
        stems.setdefault(p.stem, []).append(p)

    for stem, files in sorted(stems.items()):
        media_file = None
        txt_file = None
        media_type = None
        for f in files:
            if f.suffix.lower() in VIDEO_EXTENSIONS:
                media_file = f
                media_type = "video"
            elif f.suffix.lower() in IMG_EXTENSIONS:
                if media_file is None:
                    media_file = f
                    media_type = "image"
            elif f.suffix.lower() == ".txt":
                txt_file = f

        # Only create entry if we found a media file
        if not media_file:
            continue

        txt_path = txt_file if txt_file else (media_file.with_suffix(".txt"))
        raw_txt = ""
        if txt_path.exists():
            try:
                raw_txt = txt_path.read_text(encoding="utf-8")
            except Exception:
                raw_txt = ""

        entry = _make_entry(media_file, txt_path, raw_txt)
        if entry:
            entry["type"] = media_type
            entry["category"] = category
            entry["subfolder"] = subfolder
            entries.append(entry)

    return entries


def _scan_gallery_entries_with_subdirs(directory: Path) -> dict:
    """Scan directory and return entries grouped by subdirectory.
    
    Supports both image and video files.
    """
    result = {"root": [], "subdirs": {}}
    if not directory.exists():
        return result

    root_stems: dict[str, list[Path]] = {}
    for p in directory.iterdir():
        if p.is_file():
            lower = p.suffix.lower()
            if lower in ALL_MEDIA_EXTENSIONS or lower == ".txt":
                root_stems.setdefault(p.stem, []).append(p)

    for stem, files in sorted(root_stems.items()):
        media_file = None
        txt_file = None
        media_type = None
        for f in files:
            if f.suffix.lower() in VIDEO_EXTENSIONS:
                media_file = f
                media_type = "video"
            elif f.suffix.lower() in IMG_EXTENSIONS:
                if media_file is None:
                    media_file = f
                    media_type = "image"
            elif f.suffix.lower() == ".txt":
                txt_file = f

        if not media_file:
            continue

        txt_path = txt_file if txt_file else (media_file.with_suffix(".txt"))
        raw_txt = ""
        if txt_path.exists():
            try:
                raw_txt = txt_path.read_text(encoding="utf-8")
            except Exception:
                raw_txt = ""

        entry = _make_entry(media_file, txt_path, raw_txt)
        if entry:
            entry["type"] = media_type
            entry["category"] = ""
            entry["subfolder"] = ""
            result["root"].append(entry)

    for p in directory.iterdir():
        if p.is_dir():
            subdir_entries = _scan_gallery_entries(p, p.name)
            if subdir_entries:
                result["subdirs"][p.name] = subdir_entries

    return result


def _scan_gallery_entries_recursive(directory: Path) -> list[dict]:
    """Walk directory recursively and return gallery entries.
    
    Supports both image and video files.
    """
    entries: list[dict] = []
    if not directory.exists():
        return entries

    stems: dict[tuple[str, str], list[Path]] = {}
    for p in directory.rglob("*"):
        if not p.is_file():
            continue
        lower = p.suffix.lower()
        if lower not in ALL_MEDIA_EXTENSIONS and lower != ".txt":
            continue

        rel = p.relative_to(directory)
        parts = rel.parts
        category = ""
        subfolder = ""
        if len(parts) > 1:
            category = parts[0]
            subfolder = "/".join(parts[:-1])

        stems.setdefault((category, p.stem), []).append(p)

    for (category, stem), files in sorted(stems.items()):
        media_file = None
        txt_file = None
        media_type = None
        for f in files:
            if f.suffix.lower() in VIDEO_EXTENSIONS:
                media_file = f
                media_type = "video"
            elif f.suffix.lower() in IMG_EXTENSIONS:
                if media_file is None:
                    media_file = f
                    media_type = "image"
            elif f.suffix.lower() == ".txt":
                txt_file = f

        if not media_file:
            continue

        txt_path = txt_file if txt_file else (media_file.with_suffix(".txt"))
        raw_txt = ""
        if txt_path.exists():
            try:
                raw_txt = txt_path.read_text(encoding="utf-8")
            except Exception:
                raw_txt = ""

        entry = _make_entry(media_file, txt_path, raw_txt)
        if entry:
            entry["type"] = media_type
            entry["category"] = category
            entry["subfolder"] = subfolder or ""
            entries.append(entry)

    return entries


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/neo_gallery/list")
async def get_gallery_list(request):
    """Return unified gallery listing (all directories, presets subdirs treated as read-only dirs).
    
    Supports lazy loading via 'lazy' query parameter:
    - lazy=1: Only return directory structure (fast), no image entries
    - lazy=0 or omitted: Return full listing with image entries
    """
    lazy = request.rel_url.query.get("lazy", "0") == "1"
    user_custom_dirs = _get_user_custom_dirs()
    
    # For lazy mode, only scan structure
    if lazy:
        presets_structure = _scan_directory_structure_only(PRESETS_DIR)
    else:
        presets_structure = _scan_gallery_entries_with_subdirs(PRESETS_DIR)

    directories = []

    # Custom dirs (writable)
    for dir_path in user_custom_dirs:
        dir_name = dir_path.name if dir_path.name else str(dir_path)
        if lazy:
            structure = _scan_directory_structure_only(dir_path)
        else:
            structure = _scan_gallery_entries_with_subdirs(dir_path)
        
        if lazy:
            # Lazy mode: only return structure
            directories.append({
                "name": dir_name,
                "path": str(dir_path),
                "subdirs": structure["subdirs"],
                "root_count": structure["root_count"],
                "read_only": False,
                "lazy": True
            })
        else:
            entries = structure["root"]
            for entry in entries:
                entry["custom_source"] = dir_name
            directories.append({
                "name": dir_name,
                "path": str(dir_path),
                "items": entries,
                "subdirs": structure["subdirs"],
                "read_only": False
            })

    # Presets: root items + subdirs as read-only directories
    if lazy:
        # Lazy mode: only return structure
        presets_subdirs = presets_structure.get("subdirs", {})
        presets_root_count = presets_structure.get("root_count", 0)
        
        # Return root-level presets as a directory if there are items
        if presets_root_count > 0:
            directories.append({
                "name": "Presets",
                "path": "presets",
                "subdirs": {},
                "root_count": presets_root_count,
                "read_only": True,
                "lazy": True
            })
        
        for subdir_name, subdir_info in sorted(presets_subdirs.items()):
            directories.append({
                "name": f"Presets/{subdir_name}",
                "path": f"presets/{subdir_name}",
                "subdirs": {},
                "root_count": subdir_info.get("image_count", 0),
                "read_only": True,
                "lazy": True
            })
    else:
        presets_root = presets_structure["root"]
        presets_subdirs = presets_structure["subdirs"]

        # Root-level presets items go into a "Presets" read-only directory
        if presets_root:
            directories.append({
                "name": "Presets",
                "path": "presets",
                "items": presets_root,
                "subdirs": {},
                "read_only": True
            })

        # Each presets subdir becomes its own read-only directory
        for subdir_name, subdir_items in sorted(presets_subdirs.items()):
            if subdir_items:
                directories.append({
                    "name": f"Presets/{subdir_name}",
                    "path": f"presets/{subdir_name}",
                    "items": subdir_items,
                    "subdirs": {},
                    "read_only": True
                })

    total = sum(d.get("root_count", 0) for d in directories)
    return web.json_response({"directories": directories, "total": total})


CURRENT_WEB_DIR = CURRENT_DIR / "web"

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
    css_path = CURRENT_WEB_DIR / "gallery.css"
    if css_path.exists():
        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()
        return web.Response(text=css_content, content_type="text/css")
    return web.Response(status=404)


@PromptServer.instance.routes.get("/neo_gallery/placeholder.png")
async def serve_placeholder(request):
    return web.Response(body=_PLACEHOLDER_PNG, content_type="image/png")


@PromptServer.instance.routes.get("/neo_gallery/copy_to_input")
async def copy_to_input(request):
    try:
        import folder_paths as _folder_paths
        import shutil

        filename = request.rel_url.query.get("filename", "")
        subfolder = request.rel_url.query.get("subfolder", "")

        if not filename or ".." in filename or "/" in filename:
            return web.json_response({"success": False, "error": "Invalid filename"}, status=400)

        source_path = None
        user_custom_dirs = _get_user_custom_dirs()

        if subfolder:
            dir_parts = [p for p in subfolder.split("/") if p]
            if dir_parts[0] == "presets":
                candidate = PRESETS_DIR
                for part in dir_parts[1:]:
                    candidate = candidate / part
                candidate = candidate / filename
                if candidate.exists():
                    source_path = candidate
            else:
                for dir_path in user_custom_dirs:
                    d_name = dir_path.name if dir_path.name else str(dir_path)
                    if dir_parts[0] == d_name:
                        candidate = dir_path
                        for part in dir_parts[1:]:
                            candidate = candidate / part
                        candidate = candidate / filename
                        if candidate.exists():
                            source_path = candidate
                            break

        if not source_path:
            for dir_path in user_custom_dirs:
                candidate = dir_path / filename
                if candidate.exists():
                    source_path = candidate
                    break

        # Fallback: try subfolder as relative path under any custom dir
        if not source_path and subfolder:
            for dir_path in user_custom_dirs:
                candidate = dir_path / subfolder / filename
                if candidate.exists():
                    source_path = candidate
                    break

        if not source_path:
            candidate = PRESETS_DIR / filename
            if candidate.exists():
                source_path = candidate

        if not source_path:
            candidate = CUSTOM_DIR / filename
            if candidate.exists():
                source_path = candidate

        if not source_path:
            return web.json_response({"success": False, "error": "Image not found"}, status=404)

        input_dir = Path(_folder_paths.input_directory).resolve()
        resolved_source = source_path.resolve()
        if resolved_source.parent == input_dir:
            return web.json_response({"success": True, "filename": filename, "skipped": True})

        # Content dedup: check if input dir already has same content
        import hashlib
        source_size = source_path.stat().st_size
        source_hash = hashlib.md5()
        with source_path.open("rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                source_hash.update(chunk)
        source_md5 = source_hash.hexdigest()

        found_existing = None
        for f in input_dir.iterdir():
            if not f.is_file():
                continue
            if f.suffix.lower() not in IMG_EXTENSIONS and f.suffix.lower() not in VIDEO_EXTENSIONS:
                continue
            if f.stat().st_size != source_size:
                continue
            h = hashlib.md5()
            with open(f, "rb") as fh:
                for chunk in iter(lambda: fh.read(8192), b""):
                    h.update(chunk)
            if h.hexdigest() == source_md5:
                found_existing = f
                break

        if found_existing:
            return web.json_response({"success": True, "filename": found_existing.name, "skipped": True})

        dest_path = input_dir / filename
        if dest_path.exists():
            stem = Path(filename).stem
            ext = Path(filename).suffix
            counter = 1
            while (input_dir / f"{stem}_{counter}{ext}").exists():
                counter += 1
            dest_path = input_dir / f"{stem}_{counter}{ext}"

        shutil.copy2(source_path, dest_path)
        return web.json_response({"success": True, "filename": dest_path.name})
    except Exception as e:
        print(f"[Neo Gallery] Error copying to input: {e}")
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.get("/neo_gallery/resolve_path")
async def resolve_comfyui_path(request):
    """Resolve ComfyUI's built-in input/output directory paths."""
    path_type = request.rel_url.query.get("path_type", "").lower()

    if path_type not in ("input", "output"):
        return web.json_response({"success": False, "error": "Invalid path_type"}, status=400)

    try:
        import folder_paths as _folder_paths

        if path_type == "input":
            base_dir = _folder_paths.input_directory
        else:
            base_dir = _folder_paths.output_directory

        resolved_path = Path(base_dir).resolve()
        if not resolved_path.exists():
            return web.json_response({
                "success": False,
                "error": f"Directory does not exist: {resolved_path}"
            }, status=404)

        comfy_root = Path(__file__).parent.parent.parent.resolve()
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


def _has_media_in_dir(dir_path: Path) -> bool:
    """Check if a directory contains any media files (image or video) directly."""
    for p in dir_path.iterdir():
        if p.is_file() and p.suffix.lower() in ALL_MEDIA_EXTENSIONS:
            return True
    return False


def _has_images_in_dir(dir_path: Path) -> bool:
    """Check if a directory contains any image files directly."""
    for p in dir_path.iterdir():
        if p.is_file() and p.suffix.lower() in IMG_EXTENSIONS:
            return True
    return False


def _collect_subdirs_with_images(directory: Path, prefix: str = "") -> list[str]:
    """Recursively collect all subdirectory paths that contain images.

    Returns a flat list of relative directory names (e.g., ["dir1", "dir2/subdir"]).
    Skips intermediate directories that have no direct images but contain nested dirs with images.
    """
    result = []

    if not directory.exists():
        return result

    subdir_map = {}
    for p in sorted(directory.iterdir()):
        if not p.is_dir():
            continue

        subdir_name = p.name
        if _has_images_in_dir(p):
            subdir_map[subdir_name] = True

    for subdir_name in sorted(subdir_map.keys()):
        full_path = prefix + "/" + subdir_name if prefix else subdir_name
        result.append(full_path)

    for p in sorted(directory.iterdir()):
        if not p.is_dir():
            continue
        subdir_name = p.name

        if subdir_name in subdir_map:
            continue

        nested_result = _collect_subdirs_with_images(
            p, prefix + "/" + subdir_name if prefix else subdir_name
        )
        result.extend(nested_result)

    return result


def _collect_sample_images_recursive(directory: Path, prefix: str, max_samples: int, result: list):
    """Recursively collect up to max_samples image entries from any depth.

    This function walks the directory tree and collects images from subdirectories
    that have direct images, skipping intermediate empty directories. It stops once
    max_samples images are collected.
    
    The prefix should be a complete relative path (e.g., "mygallery/child/grandchild/images")
    so that the returned entry's subfolder field can be used to correctly construct image URLs.
    """
    if len(result) >= max_samples:
        return
    
    if not directory.exists():
        return
    
    # First, check if current directory has direct images and collect them
    if _has_images_in_dir(directory):
        dir_entries = _scan_gallery_entries(directory)
        for entry in dir_entries:
            if len(result) >= max_samples:
                return
            entry['subfolder'] = prefix
            result.append(entry)
    
    # Then recurse into subdirectories
    for p in sorted(directory.iterdir()):
        if len(result) >= max_samples:
            return
        
        if p.is_dir():
            subdir_name = p.name
            new_prefix = prefix + "/" + subdir_name if prefix else subdir_name
            
            # If this subdir has direct images, collect them as samples
            if _has_images_in_dir(p):
                subdir_entries = _scan_gallery_entries(p)
                for entry in subdir_entries:
                    if len(result) >= max_samples:
                        return
                    entry["subfolder"] = new_prefix
                    result.append(entry)
            else:
                # Recurse into nested subdirs (empty intermediate dir)
                _collect_sample_images_recursive(p, new_prefix, max_samples, result)


def _scan_directory_structure_flattened(directory: Path, base_dir: Path, sample_count: int = 0, dir_name: str = "") -> dict:
    """Scan directory and return hierarchical structure, skipping empty intermediate subdirectories.

    If an immediate subdirectory has no direct images but contains nested subdirectories
    with images, those deeper directories are returned directly (flattened), skipping the
    empty intermediate directory.

    When sample_count > 0, also collects up to that many image entries from anywhere in
    the tree for use as cover thumbnails on directory cards.
    
    The dir_name parameter is used to build complete subfolder paths for sample images,
    so they can be correctly resolved by the /neo_gallery/image endpoint.
    """
    if not directory.exists():
        return {"subdirs": [], "images": [], "sample_images": []}

    # Compute the subfolder for this directory level
    # dir_name is the root (e.g. "mygallery" or "presets"), dir_path is the target
    dir_path = directory
    # Build subfolder from dir_name + any relative path within it
    # The caller passes dir_name which is the root directory name
    # We need to figure out the subfolder relative to the base
    # For now, use dir_name as the base and compute from there
    # The caller is responsible for passing the correct dir_name
    # We compute subfolder by comparing directory to base_dir
    try:
        rel = dir_path.relative_to(base_dir)
        subfolder = str(rel)
    except ValueError:
        subfolder = ""

    all_entries = _scan_gallery_entries(directory, subfolder)

    subdir_map = {}
    immediate_subdirs_with_images = []

    for entry in all_entries:
        cat = entry.get("category", "")
        if cat:
            if cat not in subdir_map:
                subdir_map[cat] = []
                immediate_subdirs_with_images.append(cat)
            subdir_map[cat].append(entry)

    images = [e for e in all_entries if not e.get("category")]

    all_subdirs = _collect_subdirs_with_images(directory)

    # Collect sample images from any depth, using dir_name as the root prefix
    sample_images: list[dict] = []
    if sample_count > 0 and dir_name:
        # Build the full relative path for sample image subfolders
        # This ensures the subfolder field contains a complete path like "mygallery/child/grandchild/images"
        _collect_sample_images_recursive(directory, dir_name, sample_count, sample_images)

    return {
        "subdirs": all_subdirs,
        "images": images,
        "has_subdirs": len(all_subdirs) > 0,
        "image_count": len(images),
        "total_images": len(all_entries) + len(sample_images),
        "sample_images": sample_images,
    }


@PromptServer.instance.routes.get("/neo_gallery/dir_structure")
async def get_directory_structure(request):
    """Get hierarchical directory structure for a given path.

    Query params:
    - dir_name: name of the custom directory or 'presets' (required)
    - path: relative subdirectory path within that directory (optional, "/" separated)
    - samples: number of sample images to include from any depth (default 0 = none)
    """
    if "dir_name" not in request.rel_url.query:
        return web.json_response({"error": "Missing dir_name"}, status=400)

    dir_name = request.rel_url.query["dir_name"]
    rel_path = request.rel_url.query.get("path", "")
    sample_count = int(request.rel_url.query.get("samples", 0))

    # Security check for path traversal
    if ".." in rel_path:
        return web.json_response({"error": "Invalid path"}, status=400)

    base: Path | None = None
    dir_name_lower = dir_name.lower()
    if dir_name_lower == "presets":
        base = PRESETS_DIR
    elif dir_name_lower.startswith("presets/"):
        # e.g. "Presets/26-06-26" -> base = PRESETS_DIR, rel_path = "26-06-26"
        base = PRESETS_DIR
        if not rel_path:
            rel_path = dir_name_lower[len("presets/"):]
    else:
        user_custom_dirs = _get_user_custom_dirs()
        for dir_path in user_custom_dirs:
            d_name = dir_path.name if dir_path.name else str(dir_path)
            if d_name.lower() == dir_name_lower:
                base = dir_path
                break

    if base is None or not base.exists():
        return web.json_response({"error": "Directory not found"}, status=404)

    if rel_path:
        parts = [p for p in rel_path.split("/") if p]
        target_dir = base
        for part in parts:
            target_dir = target_dir / part
    else:
        target_dir = base

    # Build the full relative path for sample images using lowercase "presets"
    if rel_path:
        sample_prefix = "presets" if dir_name_lower == "presets" else ("presets/" + rel_path if dir_name_lower.startswith("presets/") else dir_name + "/" + rel_path)
    else:
        sample_prefix = "presets" if dir_name_lower.startswith("presets") else dir_name

    # Pass the full relative path so sample images get correct subfolder for image URL resolution
    structure = _scan_directory_structure_flattened(target_dir, base, sample_count, sample_prefix)

    return web.json_response({
        "dir_name": dir_name,
        "path": rel_path,
        **structure
    })


@PromptServer.instance.routes.get("/neo_gallery/dir_structure_lazy")
async def get_directory_structure_lazy(request):
    """Get lightweight directory structure for lazy loading.

    Query params:
    - dir_name: name of the custom directory or 'presets' (required)
    - path: relative subdirectory path within that directory (optional, "/" separated)
    
    Returns only directory structure (subdirectory names and image counts),
    without loading full image entries. Use this for initial fast load.
    """
    if "dir_name" not in request.rel_url.query:
        return web.json_response({"error": "Missing dir_name"}, status=400)

    dir_name = request.rel_url.query["dir_name"]
    rel_path = request.rel_url.query.get("path", "")

    # Security check for path traversal
    if ".." in rel_path:
        return web.json_response({"error": "Invalid path"}, status=400)

    base: Path | None = None
    dir_name_lower = dir_name.lower()
    if dir_name_lower == "presets":
        base = PRESETS_DIR
    elif dir_name_lower.startswith("presets/"):
        base = PRESETS_DIR
        if not rel_path:
            rel_path = dir_name_lower[len("presets/"):]
    else:
        user_custom_dirs = _get_user_custom_dirs()
        for dir_path in user_custom_dirs:
            d_name = dir_path.name if dir_path.name else str(dir_path)
            if d_name.lower() == dir_name_lower:
                base = dir_path
                break

    if base is None or not base.exists():
        return web.json_response({"error": "Directory not found"}, status=404)

    if rel_path:
        parts = [p for p in rel_path.split("/") if p]
        target_dir = base
        for part in parts:
            target_dir = target_dir / part
    else:
        target_dir = base

    # Use lightweight structure-only scan
    structure = _scan_directory_structure_only(target_dir)

    return web.json_response({
        "dir_name": dir_name,
        "path": rel_path,
        **structure
    })


# ---------------------------------------------------------------------------
# Thumbnail Routes
# ---------------------------------------------------------------------------


def _generate_thumbnail(source_path: Path, cache_path: Path, size: int = THUMBNAIL_SIZE) -> bool:
    """Generate a thumbnail image and save to cache_path.
    
    For video files, extracts first frame using ffmpeg.
    Returns True if successful, False otherwise.
    """
    try:
        # Check if source is a video file
        if source_path.suffix.lower() in VIDEO_EXTENSIONS:
            return _generate_video_thumbnail(source_path, cache_path, size)
        
        from PIL import Image
        with Image.open(source_path) as img:
            # Convert to RGB if necessary (handle RGBA, P mode, etc.)
            if img.mode not in ("RGB", "L", "RGBA"):
                img = img.convert("RGB")
            
            # Create thumbnail (in-place resize)
            img.thumbnail((size, size), Image.Resampling.LANCZOS)
            
            # Ensure directory exists
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Save as JPEG
            if img.mode == "RGBA":
                # Create white background for RGBA images
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[3])
                img = background
            
            img.save(cache_path, "JPEG", quality=85)
            return True
    except Exception as e:
        print(f"[Neo Gallery] Failed to generate thumbnail: {e}")
        return False


def _generate_video_thumbnail(source_path: Path, cache_path: Path, size: int = THUMBNAIL_SIZE) -> bool:
    """Generate a thumbnail from a video file using ffmpeg.
    
    Extracts the first frame and saves as JPEG thumbnail.
    """
    try:
        import subprocess
        import shutil
        
        # Check if ffmpeg is available
        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            print("[Neo Gallery] ffmpeg not found, skipping video thumbnail generation")
            return False
        
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Extract first frame using ffmpeg
        cmd = [
            ffmpeg_path,
            "-i", str(source_path),
            "-vframes", "1",
            "-ss", "00:00:00.500",
            "-y",
            str(cache_path)
        ]
        
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode != 0:
            # Try without -ss for first frame
            cmd = [
                ffmpeg_path,
                "-i", str(source_path),
                "-vframes", "1",
                "-y",
                str(cache_path)
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=30)
            if result.returncode != 0:
                return False
        
        return True
    except Exception as e:
        print(f"[Neo Gallery] Failed to generate video thumbnail: {e}")
        return False


def _get_thumbnail_path(filename: str, subfolder: str, size: int) -> Path:
    """Get the cache path for a thumbnail using hash based on file content.
    
    Uses date-based subdirectories (YYYY-MM) to avoid too many files in one directory.
    """
    import time
    # Find source path to compute hash from actual file properties
    source_path = _find_source_media(filename, subfolder)
    if source_path and source_path.exists():
        # Use absolute path + size + mtime for unique hash
        stat = source_path.stat()
        cache_key = f"{source_path.resolve().as_posix()}_{stat.st_size}_{stat.st_mtime}"
        # Create date-based subdirectory (YYYY-MM) from file modification time
        date_str = time.strftime("%Y-%m", time.localtime(stat.st_mtime))
    else:
        # Fallback to filename-based hash if source not found
        cache_key = f"{filename}_{subfolder}_{size}"
        date_str = time.strftime("%Y-%m")
    
    import hashlib
    hash_hex = hashlib.md5(cache_key.encode()).hexdigest()[:12]
    cache_path = THUMBNAIL_DIR / date_str / f"{hash_hex}_{size}.jpg"
    # Auto-create date directory if it doesn't exist
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    return cache_path


def _get_thumbnail_cache_dir(date_str: str) -> Path:
    """Get the cache directory for a specific date."""
    return THUMBNAIL_DIR / date_str


def _find_thumbnail_by_hash(hash_hex: str, size: int) -> Path | None:
    """Find a cached thumbnail by hash across all date directories."""
    import hashlib
    # Search in current year-month and previous months (up to 12 months back)
    import time
    now = time.localtime()
    for i in range(13):  # Check current month + 12 previous months
        y, m = now.tm_year, now.tm_mon - i
        while m <= 0:
            y -= 1
            m += 12
        date_str = f"{y:04d}-{m:02d}"
        cache_dir = THUMBNAIL_DIR / date_str
        if cache_dir.exists():
            pattern = f"{hash_hex}_*.jpg"
            for thumb_file in cache_dir.glob(pattern):
                return thumb_file
    return None


def _find_source_media(filename: str, subfolder: str) -> Path | None:
    """Find the source media file (image or video) for a given filename and subfolder."""
    user_custom_dirs = _get_user_custom_dirs()
    source_path = None
    
    # Search in custom dirs
    for dir_path in user_custom_dirs:
        candidate = dir_path / filename
        if candidate.exists():
            source_path = candidate
            break
        # Also check subfolders
        if subfolder:
            dir_parts = [p for p in subfolder.split("/") if p]
            # Match if subfolder starts with dir name, OR try as relative path under dir
            if dir_parts[0] == dir_path.name:
                candidate = dir_path
                for part in dir_parts[1:]:
                    candidate = candidate / part
                candidate = candidate / filename
                if candidate.exists():
                    source_path = candidate
                    break
            else:
                # Try subfolder as relative path under this custom dir
                candidate = dir_path
                for part in dir_parts:
                    candidate = candidate / part
                candidate = candidate / filename
                if candidate.exists():
                    source_path = candidate
                    break
    
    # Search in presets (including subfolders)
    if not source_path:
        subfolder_lower = (subfolder or "").lower()
        if subfolder_lower.startswith("presets/"):
            sub_path = subfolder_lower[len("presets/"):]
            candidate = PRESETS_DIR / sub_path / filename
            if candidate.exists():
                source_path = candidate
        elif subfolder_lower == "presets" or not subfolder:
            candidate = PRESETS_DIR / filename
            if candidate.exists():
                source_path = candidate
        else:
            # Fallback: treat subfolder as a direct subdirectory name under presets
            candidate = PRESETS_DIR / subfolder / filename
            if candidate.exists():
                source_path = candidate

    # Search in custom gallery dir
    if not source_path:
        candidate = CUSTOM_DIR / filename
        if candidate.exists():
            source_path = candidate
    
    # Fallback: try to find by extension (both image and video)
    if not source_path:
        for ext in [".jpeg", ".jpg", ".png", ".webp", ".gif", ".bmp", ".tiff",
                    ".mp4", ".webm", ".mov", ".avi", ".mkv", ".flv", ".wmv"]:
            candidate = PRESETS_DIR / (Path(filename).stem + ext)
            if candidate.exists():
                source_path = candidate
                break
    
    return source_path


def _find_source_image(filename: str, subfolder: str) -> Path | None:
    """Find the source image file for a given filename and subfolder."""
    return _find_source_media(filename, subfolder)


@PromptServer.instance.routes.get("/neo_gallery/thumbnail")
async def get_thumbnail(request):
    """Serve cached thumbnail for gallery images."""
    filename = request.rel_url.query.get("filename", "")
    subfolder = request.rel_url.query.get("subfolder", "presets")
    size = int(request.rel_url.query.get("size", THUMBNAIL_SIZE))
    
    if not filename or ".." in filename or "/" in filename:
        return web.Response(status=400)
    
    # Find the source image
    source_path = _find_source_image(filename, subfolder)
    
    if not source_path:
        return web.Response(status=404)
    
    # Get cache path
    cache_path = _get_thumbnail_path(filename, subfolder, size)
    
    # Check if cache is valid (exists and is newer than source)
    use_cache = False
    if cache_path.exists():
        try:
            cache_mtime = cache_path.stat().st_mtime
            source_mtime = source_path.stat().st_mtime
            if cache_mtime >= source_mtime:
                use_cache = True
        except Exception:
            pass
    
    if use_cache:
        # Return cached thumbnail with long-term caching headers
        # Since URL is deterministic (hash-based), browser can cache indefinitely
        with open(cache_path, "rb") as f:
            content = f.read()
        return web.Response(
            body=content, 
            content_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "ETag": f'"{cache_path.stat().st_mtime}-{cache_path.stat().st_size}"'
            }
        )
    
    # Generate thumbnail
    if _generate_thumbnail(source_path, cache_path, size):
        with open(cache_path, "rb") as f:
            content = f.read()
        return web.Response(
            body=content, 
            content_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "ETag": f'"{cache_path.stat().st_mtime}-{cache_path.stat().st_size}"'
            }
        )
    
    # Fallback: return original image
    with open(source_path, "rb") as f:
        content = f.read()
    content_type, _ = mimetypes.guess_type(str(source_path))
    if not content_type:
        content_type = "image/jpeg"
    return web.Response(body=content, content_type=content_type)


@PromptServer.instance.routes.get("/neo_gallery/video")
async def view_video(request):
    """Serve gallery videos by filename."""
    if "filename" not in request.rel_url.query:
        return web.Response(status=400)

    filename = request.rel_url.query["filename"]
    subfolder = request.rel_url.query.get("subfolder", "presets")

    if ".." in filename or ".." in subfolder:
        return web.Response(status=400)

    source_path = _find_source_media(filename, subfolder)
    if not source_path:
        return web.Response(status=404)

    if source_path.suffix.lower() not in VIDEO_EXTENSIONS:
        return web.Response(status=400)

    with open(source_path, "rb") as f:
        content = f.read()
    content_type, _ = mimetypes.guess_type(str(source_path))
    if not content_type:
        content_type = "video/mp4"
    return web.Response(
        body=content,
        content_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{source_path.name}"'},
    )


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

    if subfolder.startswith("__"):
        return web.Response(status=400)

    user_custom_dirs = _get_user_custom_dirs()
    base: Path | None = None

    dir_parts = [p for p in subfolder.split("/") if p]
    subfolder_lower = subfolder.lower()

    def _match_dir_name(parts_list):
        target = parts_list[0].lower()
        for dir_path in user_custom_dirs:
            if dir_path.name.lower() == target:
                return dir_path
        return None

    if subfolder_lower == "presets" or subfolder_lower == "":
        base = PRESETS_DIR
    elif subfolder_lower == "custom":
        base = CUSTOM_DIR
    elif len(dir_parts) > 0 and dir_parts[0].lower() == "presets":
        base = PRESETS_DIR / "/".join(dir_parts[1:])
    elif len(dir_parts) > 0 and len(dir_parts) == 1:
        candidate = PRESETS_DIR / dir_parts[0]
        if candidate.exists():
            base = candidate
        else:
            matched_dir = _match_dir_name(dir_parts)
            if matched_dir:
                base = matched_dir
            else:
                # Try as subdirectory under any custom dir
                for dir_path in user_custom_dirs:
                    candidate = dir_path / dir_parts[0]
                    if candidate.exists():
                        base = candidate
                        break
    elif len(dir_parts) > 1:
        matched_dir = _match_dir_name(dir_parts)
        if matched_dir:
            base = matched_dir / "/".join(dir_parts[1:])
    else:
        for dir_path in user_custom_dirs:
            d_name = dir_path.name if dir_path.name else str(dir_path)
            if subfolder_lower == d_name.lower():
                base = dir_path
                break

    if base is None or not base.exists():
        return web.Response(status=404)

    fullpath = None

    from pathlib import PurePath as _PurePath
    _p = _PurePath(filename)
    file_stem = _p.stem

    checked_paths = set()

    candidates_to_try = [filename]
    for ext in [".jpeg", ".jpg", ".png", ".webp", ".gif", ".bmp", ".tiff"]:
        candidates_to_try.append(file_stem + ext)

    use_category = category and not any(part in subfolder for part in category.split("/"))

    for candidate_filename in candidates_to_try:
        if candidate_filename in checked_paths:
            continue

        if use_category and category:
            candidate = base / category / candidate_filename
            if candidate.exists():
                fullpath = candidate
                checked_paths.add(str(candidate))
                break

        if not fullpath:
            candidate = base / candidate_filename
            if candidate.exists():
                fullpath = candidate
                checked_paths.add(str(candidate))
                break

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


# ---------------------------------------------------------------------------
# Settings Routes (custom presets directory)
# ---------------------------------------------------------------------------

SETTINGS_FILE = CURRENT_DIR / "gallery_settings.json"


def _save_settings(settings: dict):
    try:
        with open(SETTINGS_FILE, "w") as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        print(f"[Neo Gallery] Failed to save settings: {e}")


def _load_settings() -> dict:
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        print(f"[Neo Gallery] Failed to load settings: {e}")
    return {}


@PromptServer.instance.routes.post("/neo_gallery/save_settings")
async def save_gallery_settings(request):
    """Save gallery settings (custom directories list)."""
    try:
        data = await request.json()
        current_settings = _load_settings()

        action = data.get("action")

        if action == "add":
            new_dir = data.get("path", "").strip()
            if not new_dir:
                return web.json_response({"success": False, "error": "No path provided"}, status=400)
            if not Path(new_dir).exists():
                return web.json_response(
                    {"success": False, "error": f"Directory not found: {new_dir}"},
                    status=400
                )
            dirs = current_settings.get("custom_directories", [])
            if new_dir not in dirs:
                dirs.append(new_dir)
            current_settings["custom_directories"] = dirs
            current_settings.pop("custom_directory", None)

        elif action == "remove":
            remove_path = data.get("path", "").strip()
            dirs = current_settings.get("custom_directories", [])
            if remove_path in dirs:
                dirs.remove(remove_path)
            current_settings["custom_directories"] = dirs

        elif action == "list":
            pass

        else:
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


@PromptServer.instance.routes.post("/neo_gallery/delete")
async def delete_gallery_item(request):
    """Delete a custom image + its .txt companion. Presets are read-only."""
    try:
        data = await request.json()
        filename = data.get("filename", "")
        subfolder = data.get("subfolder", "")

        # --- Input validation ---
        if not filename or ".." in filename:
            return web.json_response({"success": False, "error": "Invalid filename"}, status=400)

        # --- Read-only check for presets ---
        subfolder_lower = (subfolder or "").lower()
        if subfolder_lower == "presets" or subfolder_lower.startswith("presets/"):
            return web.json_response({"success": False, "error": "Cannot delete from read-only presets directory"}, status=403)

        # --- Resolve base directory and target path ---
        user_custom_dirs = _get_user_custom_dirs()
        
        print(f"[Neo Gallery] DELETE called: filename={filename!r}, subfolder={subfolder!r}")
        print(f"[Neo Gallery] Custom dirs count: {len(user_custom_dirs)}")
        for d in user_custom_dirs:
            print(f"  - {d}")

        base: Path | None = None
        found_path: Path | None = None
        
        # Single unified search: try every custom dir + subfolder + filename with every extension
        for dir_path in user_custom_dirs:
            if subfolder:
                candidate_base = dir_path / subfolder
            else:
                candidate_base = dir_path
            
            # Try exact filename first (without extension) — only if it exists as-is
            if (candidate_base / filename).is_file():
                base = dir_path
                found_path = candidate_base / filename
                print(f"[Neo Gallery] Found exact match: {found_path}")
                break
            
            # Try with every media extension
            for ext in ALL_MEDIA_EXTENSIONS:
                candidate = candidate_base / f"{filename}{ext}"
                if candidate.exists():
                    base = dir_path
                    found_path = candidate
                    print(f"[Neo Gallery] Found with extension {ext}: {candidate}")
                    break
            
            if base:
                break

        # Fallback: also check without subfolder prefix (root-level files)
        if not base:
            for dir_path in user_custom_dirs:
                for ext in ALL_MEDIA_EXTENSIONS:
                    candidate = dir_path / f"{filename}{ext}"
                    if candidate.exists():
                        base = dir_path
                        found_path = candidate
                        print(f"[Neo Gallery] Fallback found: {candidate}")
                        break
                if base:
                    break

        if not base or not found_path:
            return web.json_response({"success": False, "error": f"Source file not found (filename={filename!r}, subfolder={subfolder!r})"}, status=404)

        # --- Resolve target directory ---
        target_dir = found_path.parent
        delete_filename = found_path.name  # Use the full filename with extension

        print(f"[Neo Gallery] Target dir: {target_dir}, file: {delete_filename}")

        if not target_dir.exists():
            return web.json_response({"success": False, "error": f"Target directory not found: {target_dir}"}, status=404)

        # --- Delete media files (use found_path's exact name) ---
        img_deleted = False
        if found_path and found_path.suffix.lower() in ALL_MEDIA_EXTENSIONS:
            try:
                found_path.unlink()
                img_deleted = True
                print(f"[Neo Gallery] Deleted media: {found_path}")
            except Exception as e:
                print(f"[Neo Gallery] Failed to delete {found_path}: {e}")

        # --- Delete .txt companion (use the same stem as found_path) ---
        txt_deleted = False
        txt_stem = found_path.stem  # Use the stem of the actual file, not the original filename
        txt = target_dir / f"{txt_stem}.txt"
        if txt.exists():
            try:
                txt.unlink()
                txt_deleted = True
                print(f"[Neo Gallery] Deleted txt: {txt}")
            except Exception as e:
                print(f"[Neo Gallery] Failed to delete {txt}: {e}")

        # Also check for .txt with the original filename stem (fallback)
        if not txt_deleted and filename:
            orig_txt = target_dir / f"{filename}.txt"
            if orig_txt.exists():
                try:
                    orig_txt.unlink()
                    txt_deleted = True
                except Exception as e:
                    print(f"[Neo Gallery] Failed to delete {orig_txt}: {e}")

        # Also check for .txt with the stem directly (no extension prefix)
        if not img_deleted and found_path.suffix.lower() != ".txt":
            stem_path = target_dir / found_path.name
            if stem_path.exists() and stem_path.suffix.lower() == ".txt":
                try:
                    stem_path.unlink()
                    txt_deleted = True
                except Exception as e:
                    print(f"[Neo Gallery] Failed to delete {stem_path}: {e}")

        # --- Delete cached thumbnails matching this file ---
        thumb_count = 0
        filename_stem = Path(filename).stem
        for date_dir in THUMBNAIL_DIR.iterdir():
            if not date_dir.is_dir():
                continue
            # Pattern 1: old format "{stem}_*.jpg"
            try:
                for thumb_file in date_dir.glob(f"{filename_stem}_*.jpg"):
                    try:
                        thumb_file.unlink()
                        thumb_count += 1
                    except Exception:
                        pass
            except Exception:
                pass

            # Pattern 2: hash-based cache (new format) — recompute and delete
            try:
                import hashlib as _hashlib
                source_path = _find_source_media(filename, subfolder)
                if source_path and source_path.exists():
                    stat = source_path.stat()
                    cache_key = f"{source_path.resolve().as_posix()}_{stat.st_size}_{stat.st_mtime}"
                    hash_hex = _hashlib.md5(cache_key.encode()).hexdigest()[:12]
                    for thumb_file in date_dir.glob(f"{hash_hex}_*.jpg"):
                        try:
                            thumb_file.unlink()
                            thumb_count += 1
                        except Exception:
                            pass
            except Exception:
                pass

        return web.json_response({
            "success": True,
            "deleted": img_deleted or txt_deleted,
            "image_deleted": img_deleted,
            "txt_deleted": txt_deleted,
            "thumbnails_cleared": thumb_count
        })
    except Exception as e:
        print(f"[Neo Gallery] delete_gallery_item error: {e}")
        import traceback
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)}, status=500)


@PromptServer.instance.routes.post("/neo_gallery/clear_thumbnails")
async def clear_thumbnails(request):
    """Clear all cached thumbnails for a given subfolder."""
    try:
        data = await request.json()
        subfolder = data.get("subfolder", "")
        
        if not subfolder:
            # Clear all thumbnails by removing date directories
            import shutil
            for date_dir in THUMBNAIL_DIR.iterdir():
                if date_dir.is_dir():
                    shutil.rmtree(date_dir)
            return web.json_response({"success": True, "cleared": "all"})
        
        # For specific subfolder, clear all date directories (hash-based cache)
        count = 0
        for date_dir in THUMBNAIL_DIR.iterdir():
            if not date_dir.is_dir():
                continue
            for thumb_file in date_dir.glob("*.jpg"):
                thumb_file.unlink()
                count += 1
        
        return web.json_response({"success": True, "cleared": count})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# Ensure gallery directories exist on module load
_ensure_dirs()

# Diagnostic: log route registration
import sys as _sys
print(f"[Neo Gallery] Module loaded from: {__file__}", file=_sys.stderr, flush=True)
print(f"[Neo Gallery] Routes registered: {hasattr(PromptServer.instance, 'routes') and hasattr(PromptServer.instance.routes, '_grouped')}", file=_sys.stderr, flush=True)
