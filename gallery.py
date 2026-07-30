# SPDX-License-Identifier: Apache-2.0
# ComfyUI-Neo-Nodes — Gallery Module (preset-based: image + .txt by same name)

import os
import re
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

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


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
    """Build a gallery entry dict from image + txt paths."""
    try:
        raw = image_path.read_bytes()
        preview_b64 = base64.b64encode(raw).decode("ascii")
        ext = image_path.suffix.lower()
        if ext == ".jpeg":
            ext = ".jpg"
        mime = f"image/{ext.lstrip('.')}"
        preview_datauri = f"data:{mime};base64,{preview_b64}"
    except Exception:
        preview_datauri = None

    fields = _parse_txt(raw_txt)
    fields["preview"] = preview_datauri

    return {
        "name": image_path.stem,
        "filename": image_path.name,
        "txt_file": txt_path.name,
        **fields,
    }


def _scan_gallery_entries(directory: Path) -> list[dict]:
    """Walk directory and return gallery entries.

    Strategy: group files by stem. An image + sibling .txt = valid preset.
    """
    entries: list[dict] = []
    if not directory.exists():
        return entries

    stems: dict[str, list[Path]] = {}
    for p in directory.iterdir():
        if not p.is_file():
            continue
        lower = p.suffix.lower()
        if lower not in IMG_EXTENSIONS and lower != ".txt":
            continue
        stems.setdefault(p.stem, []).append(p)

    for stem, files in sorted(stems.items()):
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
            entries.append(entry)

    return entries


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@PromptServer.instance.routes.get("/neo_gallery/list")
async def get_gallery_list(request):
    """Return gallery listing (presets + custom)."""
    presets = _scan_gallery_entries(PRESETS_DIR)
    custom = _scan_gallery_entries(CUSTOM_DIR)
    return web.json_response({
        "presets": presets,
        "custom": custom,
        "total": len(presets) + len(custom)
    })


@PromptServer.instance.routes.get("/neo_gallery/image")
async def view_image(request):
    """Serve gallery images by filename."""
    if "filename" not in request.rel_url.query:
        return web.Response(status=400)

    filename = request.rel_url.query["filename"]
    subfolder = request.rel_url.query.get("subfolder", "presets")

    if ".." in filename or ".." in subfolder:
        return web.Response(status=400)

    base = PRESETS_DIR if subfolder == "presets" else CUSTOM_DIR
    if subfolder not in ("presets", "custom"):
        return web.Response(status=400)

    for ext in ["", ".jpeg", ".jpg", ".png", ".webp"]:
        fullpath = base / f"{filename}{ext}"
        if fullpath.exists():
            with open(fullpath, "rb") as f:
                content = f.read()
            content_type, _ = mimetypes.guess_type(str(fullpath))
            if not content_type:
                content_type = "application/octet-stream"
            return web.Response(
                body=content,
                content_type=content_type,
                headers={"Content-Disposition": f'inline; filename="{filename}{ext}"'},
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

        base = PRESETS_DIR if subfolder == "presets" else CUSTOM_DIR
        if not base.exists():
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