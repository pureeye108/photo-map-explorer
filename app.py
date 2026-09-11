import os
import io
import re
import json
import time
import uuid
import logging
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

from flask import Flask, request, jsonify, render_template, send_from_directory
from PIL import Image, ImageOps, ExifTags
import pillow_heif
import exifread
import rawpy

# Register HEIC/HEIF plugin for Pillow
pillow_heif.register_heif_opener()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 250 * 1024 * 1024  # 250 MB max upload limit

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DB_FILE = UPLOAD_DIR / "photos_db.json"

RAW_EXTENSIONS = {".cr2", ".cr3", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef", ".raf"}
STANDARD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tiff", ".tif"}

# In-memory photo storage
photos_db = {}
reverse_cache = {}
search_cache = {}


def load_db():
    global photos_db
    if DB_FILE.exists():
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                photos_db = json.load(f)
            logging.info(f"Loaded {len(photos_db)} photos from database.")
        except Exception as e:
            logging.error(f"Error loading photos db: {e}")
            photos_db = {}


def save_db():
    try:
        with open(DB_FILE, "w", encoding="utf-8") as f:
            json.dump(photos_db, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logging.error(f"Error saving photos db: {e}")


# Initialize database on startup
load_db()


def _ratio_to_float(r):
    try:
        if hasattr(r, "num") and hasattr(r, "den"):
            return float(r.num) / float(r.den) if r.den != 0 else 0.0
        if isinstance(r, (tuple, list)) and len(r) == 2:
            return float(r[0]) / float(r[1]) if r[1] != 0 else 0.0
        return float(r)
    except Exception:
        return 0.0


def _parse_dms(values, ref):
    if not values or len(values) < 3:
        return None
    d = _ratio_to_float(values[0])
    m = _ratio_to_float(values[1])
    s = _ratio_to_float(values[2])
    deg = d + (m / 60.0) + (s / 3600.0)
    if str(ref).strip().upper() in ["S", "W"]:
        deg = -deg
    return deg


def extract_exif_data(file_path, original_filename):
    """
    Extracts EXIF metadata including GPS coordinates and camera specs
    supporting both standard images and camera RAW files.
    """
    ext = Path(original_filename).suffix.lower()
    meta = {
        "latitude": None,
        "longitude": None,
        "altitude": None,
        "date_taken": None,
        "camera_make": None,
        "camera_model": None,
        "lens": None,
        "focal_length": None,
        "f_number": None,
        "exposure_time": None,
        "iso": None,
    }

    # 1. Try exifread first (great for RAW and standard files)
    try:
        with open(file_path, "rb") as f:
            tags = exifread.process_file(f, details=False)

        # GPS Latitude
        lat_tag = tags.get("GPS GPSLatitude")
        lat_ref = tags.get("GPS GPSLatitudeRef")
        lon_tag = tags.get("GPS GPSLongitude")
        lon_ref = tags.get("GPS GPSLongitudeRef")
        alt_tag = tags.get("GPS GPSAltitude")
        alt_ref = tags.get("GPS GPSAltitudeRef")

        if lat_tag and lat_ref and lon_tag and lon_ref:
            meta["latitude"] = _parse_dms(lat_tag.values, lat_ref.printable)
            meta["longitude"] = _parse_dms(lon_tag.values, lon_ref.printable)

        if alt_tag:
            alt_val = _ratio_to_float(alt_tag.values[0] if isinstance(alt_tag.values, list) else alt_tag.values)
            if alt_ref and str(alt_ref.values[0]) == "1":
                alt_val = -alt_val
            meta["altitude"] = round(alt_val, 1)

        # Camera & Date tags
        if "Image Make" in tags:
            meta["camera_make"] = str(tags["Image Make"]).strip()
        if "Image Model" in tags:
            meta["camera_model"] = str(tags["Image Model"]).strip()
        if "EXIF LensModel" in tags:
            meta["lens"] = str(tags["EXIF LensModel"]).strip()
        if "EXIF DateTimeOriginal" in tags:
            meta["date_taken"] = str(tags["EXIF DateTimeOriginal"]).strip()
        elif "Image DateTime" in tags:
            meta["date_taken"] = str(tags["Image DateTime"]).strip()

        if "EXIF FNumber" in tags:
            fn = _ratio_to_float(tags["EXIF FNumber"].values[0] if isinstance(tags["EXIF FNumber"].values, list) else tags["EXIF FNumber"].values)
            if fn > 0:
                meta["f_number"] = f"f/{fn:.1f}"
        if "EXIF ExposureTime" in tags:
            meta["exposure_time"] = str(tags["EXIF ExposureTime"]) + "s"
        if "EXIF ISOSpeedRatings" in tags:
            meta["iso"] = f"ISO {tags['EXIF ISOSpeedRatings']}"
        if "EXIF FocalLength" in tags:
            fl = _ratio_to_float(tags["EXIF FocalLength"].values[0] if isinstance(tags["EXIF FocalLength"].values, list) else tags["EXIF FocalLength"].values)
            if fl > 0:
                meta["focal_length"] = f"{int(fl)}mm"
    except Exception as e:
        logging.warning(f"exifread parsing error on {original_filename}: {e}")

    # 2. Fallback to Pillow EXIF for standard formats if GPS wasn't found
    if meta["latitude"] is None and ext not in RAW_EXTENSIONS:
        try:
            with Image.open(file_path) as img:
                exif = img.getexif()
                if exif:
                    gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo) if hasattr(ExifTags, "IFD") else None
                    if gps_ifd:
                        lat = gps_ifd.get(2)
                        lat_ref = gps_ifd.get(1)
                        lon = gps_ifd.get(4)
                        lon_ref = gps_ifd.get(3)
                        alt = gps_ifd.get(6)
                        alt_ref = gps_ifd.get(5, 0)
                        if lat and lat_ref and lon and lon_ref:
                            meta["latitude"] = _parse_dms(lat, lat_ref)
                            meta["longitude"] = _parse_dms(lon, lon_ref)
                        if alt is not None:
                            meta["altitude"] = round(float(alt) * (-1 if alt_ref == 1 else 1), 1)

                    if not meta["date_taken"]:
                        dt = exif.get(306) or exif.get(36867)
                        if dt:
                            meta["date_taken"] = str(dt)
                    if not meta["camera_make"] and exif.get(271):
                        meta["camera_make"] = str(exif.get(271)).strip()
                    if not meta["camera_model"] and exif.get(272):
                        meta["camera_model"] = str(exif.get(272)).strip()
        except Exception as e:
            logging.warning(f"Pillow EXIF fallback error on {original_filename}: {e}")

    return meta


def process_image_and_generate_thumbnails(file_path, original_filename, photo_id):
    """
    Renders preview and thumbnail JPEG images.
    Supports camera RAW formats via rawpy and standard formats via Pillow.
    """
    ext = Path(original_filename).suffix.lower()
    preview_filename = f"preview_{photo_id}.jpg"
    thumb_filename = f"thumb_{photo_id}.jpg"
    preview_path = UPLOAD_DIR / preview_filename
    thumb_path = UPLOAD_DIR / thumb_filename

    pil_img = None

    if ext in RAW_EXTENSIONS:
        try:
            with rawpy.imread(str(file_path)) as raw:
                try:
                    thumb = raw.extract_thumb()
                    if thumb.format == rawpy.ThumbFormat.JPEG:
                        pil_img = Image.open(io.BytesIO(thumb.data))
                    elif thumb.format == rawpy.ThumbFormat.BITMAP:
                        pil_img = Image.fromarray(thumb.data)
                except Exception as thumb_err:
                    logging.info(f"Embedded thumb not available for RAW: {thumb_err}")

                if pil_img is None:
                    rgb = raw.postprocess(half_size=True, use_camera_wb=True)
                    pil_img = Image.fromarray(rgb)
        except Exception as raw_err:
            logging.error(f"Error decoding RAW file {original_filename}: {raw_err}")
            raise

    else:
        try:
            pil_img = Image.open(file_path)
            pil_img = ImageOps.exif_transpose(pil_img)
            if pil_img.mode in ("RGBA", "P", "LA"):
                pil_img = pil_img.convert("RGB")
        except Exception as img_err:
            logging.error(f"Error opening image {original_filename}: {img_err}")
            raise

    if pil_img is None:
        raise ValueError(f"Could not decode image {original_filename}")

    if pil_img.mode != "RGB":
        pil_img = pil_img.convert("RGB")

    orig_width, orig_height = pil_img.size

    # Save preview image (max 1600px)
    preview_img = pil_img.copy()
    preview_img.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    preview_img.save(preview_path, "JPEG", quality=85, optimize=True)

    # Save thumbnail (max 320px)
    thumb_img = pil_img.copy()
    thumb_img.thumbnail((320, 320), Image.Resampling.LANCZOS)
    thumb_img.save(thumb_path, "JPEG", quality=80, optimize=True)

    return preview_filename, thumb_filename, orig_width, orig_height


def reverse_geocode(lat, lon):
    """
    Reverse geocodes coordinates to a readable address using OpenStreetMap Nominatim.
    """
    key = f"{round(lat, 3)},{round(lon, 3)}"
    if key in reverse_cache:
        return reverse_cache[key]

    url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=14&addressdetails=1"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PhotoMapExplorer/1.0 (free-open-source)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            addr = data.get("address", {})
            parts = []
            landmark = addr.get("tourism") or addr.get("historic") or addr.get("amenity") or addr.get("leisure")
            if landmark:
                parts.append(landmark)
            city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("suburb")
            if city:
                parts.append(city)
            state = addr.get("state") or addr.get("province")
            if state and state != city:
                parts.append(state)
            country = addr.get("country")
            if country:
                parts.append(country)

            result = ", ".join(parts) if parts else data.get("display_name", f"{lat:.4f}, {lon:.4f}")
            reverse_cache[key] = result
            return result
    except Exception as e:
        logging.warning(f"Reverse geocode lookup failed: {e}")
        return f"{lat:.4f}, {lon:.4f}"


def search_nominatim_landmark(query):
    """
    Searches OpenStreetMap Nominatim for landmark or place names without any API key.
    """
    query_clean = query.strip()
    if not query_clean or len(query_clean) < 2:
        return []

    if query_clean.lower() in search_cache:
        return search_cache[query_clean.lower()]

    url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query_clean)}&format=json&limit=5&addressdetails=1"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PhotoMapExplorer/1.0 (free-open-source)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = []
            for item in data:
                display = item.get("display_name", "")
                parts = display.split(",")
                short_name = parts[0].strip() if parts else item.get("name", query_clean)
                results.append({
                    "name": short_name,
                    "display_name": display,
                    "latitude": float(item["lat"]),
                    "longitude": float(item["lon"]),
                    "type": item.get("type", "landmark")
                })
            search_cache[query_clean.lower()] = results
            return results
    except Exception as e:
        logging.warning(f"Nominatim search failed for '{query}': {e}")
        return []


def clean_filename_for_places(filename):
    """
    Strips camera prefixes and numbers from filename to extract potential place/landmark keywords.
    E.g. 'Eiffel_Tower_001.jpg' -> 'Eiffel Tower'
    """
    name = re.sub(r'\.[a-zA-Z0-9]+$', '', filename)
    name = re.sub(r'^(IMG|DSC|P|DJI|SAM|PHOTO|PICT)[-_]?[0-9]+.*', '', name, flags=re.I)
    name = re.sub(r'[-_]+', ' ', name)
    name = re.sub(r'\b(copy|\d{1,4})\b', '', name, flags=re.I).strip()
    return name


def detect_landmark_gemini(thumb_path, api_key=None):
    """
    Optional: Uses Google Gemini Vision AI if an API key is provided.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        return {"success": False, "error": "No API key", "detected": False}

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=key)
        with open(thumb_path, "rb") as f:
            image_bytes = f.read()

        prompt = (
            "Analyze this photo carefully. Determine if it shows a recognizable geographic landmark, "
            "famous tourist attraction, historic monument, famous building, natural wonder, or distinctive city skyline.\n"
            "Respond strictly with a JSON object conforming to this schema:\n"
            "{\n"
            '  "detected": true/false,\n'
            '  "landmark_name": "Name of the landmark or site (e.g. Eiffel Tower, Taj Mahal, Golden Gate Bridge) or null",\n'
            '  "location_name": "City, State/Region, Country (or null)",\n'
            '  "latitude": float latitude coordinate (or null),\n'
            '  "longitude": float longitude coordinate (or null),\n'
            '  "confidence": "high" | "medium" | "low" | "none",\n'
            '  "reasoning": "Brief explanation of visual features or architectural cues identified"\n'
            "}\n"
            "If ordinary personal photo, food, or unidentifiable scene, set detected: false."
        )

        model_name = "gemini-2.5-flash"
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2,
                )
            )
            raw_text = response.text
        except Exception as e_flash:
            model_name = "gemini-1.5-flash"
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2,
                )
            )
            raw_text = response.text

        raw_text = raw_text.strip()
        if raw_text.startswith("```json"):
            raw_text = raw_text[7:]
        if raw_text.startswith("```"):
            raw_text = raw_text[3:]
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3]

        parsed = json.loads(raw_text.strip())
        return {"success": True, **parsed}

    except Exception as e:
        logging.error(f"Gemini landmark detection error: {e}")
        return {"success": False, "error": str(e), "detected": False}


# ---------------- API ROUTES ----------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/photos", methods=["GET"])
def get_photos():
    return jsonify(list(photos_db.values()))


@app.route("/api/upload", methods=["POST"])
def upload_files():
    if "files" not in request.files:
        return jsonify({"error": "No files uploaded"}), 400

    uploaded_files = request.files.getlist("files")
    results = []

    for f in uploaded_files:
        if not f.filename:
            continue

        original_filename = f.filename
        ext = Path(original_filename).suffix.lower()
        if ext not in STANDARD_EXTENSIONS and ext not in RAW_EXTENSIONS:
            continue

        photo_id = str(uuid.uuid4())[:12]
        saved_raw_path = UPLOAD_DIR / f"{photo_id}_{Path(original_filename).name}"

        try:
            f.save(saved_raw_path)

            preview_fn, thumb_fn, width, height = process_image_and_generate_thumbnails(
                saved_raw_path, original_filename, photo_id
            )

            exif_meta = extract_exif_data(saved_raw_path, original_filename)

            lat = exif_meta["latitude"]
            lon = exif_meta["longitude"]

            address = None
            location_source = "none"
            warning = None
            landmark_name = None

            if lat is not None and lon is not None:
                location_source = "gps"
                address = reverse_geocode(lat, lon)
            else:
                # Check if filename has an obvious landmark keyword
                kw = clean_filename_for_places(original_filename)
                if kw and len(kw) >= 3:
                    matches = search_nominatim_landmark(kw)
                    if matches:
                        match = matches[0]
                        lat = match["latitude"]
                        lon = match["longitude"]
                        landmark_name = match["name"]
                        address = match["display_name"]
                        location_source = "landmark"
                        warning = (
                            f"Estimated Location: Landmark '{landmark_name}' inferred from filename. "
                            f"Note: Not verified by camera GPS metadata."
                        )

                if lat is None:
                    warning = "No GPS metadata found. Search a landmark or click on the map to locate."

            photo_record = {
                "id": photo_id,
                "filename": original_filename,
                "file_type": "raw" if ext in RAW_EXTENSIONS else "standard",
                "extension": ext,
                "width": width,
                "height": height,
                "preview_url": f"/static/uploads/{preview_fn}",
                "thumb_url": f"/static/uploads/{thumb_fn}",
                "latitude": lat,
                "longitude": lon,
                "altitude": exif_meta["altitude"],
                "address": address,
                "location_source": location_source,
                "landmark_name": landmark_name,
                "landmark_confidence": "medium" if landmark_name else None,
                "landmark_reasoning": "Matched via place/landmark search" if landmark_name else None,
                "warning": warning,
                "date_taken": exif_meta["date_taken"],
                "camera_make": exif_meta["camera_make"],
                "camera_model": exif_meta["camera_model"],
                "lens": exif_meta["lens"],
                "focal_length": exif_meta["focal_length"],
                "f_number": exif_meta["f_number"],
                "exposure_time": exif_meta["exposure_time"],
                "iso": exif_meta["iso"],
                "created_at": datetime.now().isoformat(),
            }

            photos_db[photo_id] = photo_record
            results.append(photo_record)

        except Exception as e:
            logging.error(f"Failed to process {original_filename}: {e}")
            results.append({
                "filename": original_filename,
                "error": str(e)
            })

    save_db()
    return jsonify({"processed": len(results), "photos": results})


@app.route("/api/search-landmark", methods=["GET"])
def search_landmark_route():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify([])
    results = search_nominatim_landmark(query)
    return jsonify(results)


@app.route("/api/detect-landmark", methods=["POST"])
def detect_landmark():
    data = request.get_json() or {}
    photo_id = data.get("photo_id")
    api_key = data.get("api_key") or request.headers.get("X-Gemini-Key") or os.environ.get("GEMINI_API_KEY")

    if not photo_id or photo_id not in photos_db:
        return jsonify({"error": "Photo not found"}), 404

    photo = photos_db[photo_id]
    thumb_path = UPLOAD_DIR / f"thumb_{photo_id}.jpg"

    # 1. If Gemini API key is provided, use Vision AI
    if api_key:
        detection = detect_landmark_gemini(thumb_path, api_key)
        if detection.get("detected") and detection.get("latitude") and detection.get("longitude"):
            photo["latitude"] = float(detection["latitude"])
            photo["longitude"] = float(detection["longitude"])
            photo["landmark_name"] = detection.get("landmark_name")
            photo["landmark_confidence"] = detection.get("confidence", "medium")
            photo["landmark_reasoning"] = detection.get("reasoning")
            photo["location_source"] = "landmark"
            photo["address"] = detection.get("location_name") or reverse_geocode(photo["latitude"], photo["longitude"])
            photo["warning"] = (
                f"Estimated Location: Landmark identified as \"{photo['landmark_name']}\" "
                f"({photo['landmark_confidence'].upper()} confidence). "
                f"Note: Estimated by visual AI and is NOT verified by camera GPS metadata."
            )
            save_db()
            return jsonify({"success": True, "photo": photo, "detected": True})

    # 2. No API Key (or AI didn't find it): Free fallback via filename/search
    kw = clean_filename_for_places(photo["filename"])
    if kw and len(kw) >= 3:
        matches = search_nominatim_landmark(kw)
        if matches:
            match = matches[0]
            photo["latitude"] = match["latitude"]
            photo["longitude"] = match["longitude"]
            photo["landmark_name"] = match["name"]
            photo["landmark_confidence"] = "medium"
            photo["landmark_reasoning"] = f"Identified location '{match['name']}' from filename keyword '{kw}'"
            photo["location_source"] = "landmark"
            photo["address"] = match["display_name"]
            photo["warning"] = (
                f"Estimated Location: Landmark identified as \"{photo['landmark_name']}\". "
                f"Note: This is estimated from place keyword and is NOT verified by camera GPS."
            )
            save_db()
            return jsonify({"success": True, "photo": photo, "detected": True})

    # 3. Prompt user with zero-API-key search modal
    return jsonify({
        "success": True,
        "detected": False,
        "needs_search": True,
        "suggested_query": kw or "",
        "message": "Enter landmark name to locate without API key."
    })


@app.route("/api/update-location", methods=["POST"])
def update_location():
    data = request.get_json() or {}
    photo_id = data.get("photo_id")
    lat = data.get("latitude")
    lon = data.get("longitude")
    landmark_name = data.get("landmark_name")
    source = data.get("source", "manual")  # 'manual' or 'landmark'

    if not photo_id or photo_id not in photos_db:
        return jsonify({"error": "Photo not found"}), 404

    if lat is None or lon is None:
        return jsonify({"error": "Missing coordinates"}), 400

    photo = photos_db[photo_id]
    photo["latitude"] = float(lat)
    photo["longitude"] = float(lon)
    photo["location_source"] = source
    if source == "landmark" and landmark_name:
        photo["landmark_name"] = landmark_name
        photo["warning"] = (
            f"Estimated Location: Landmark set to \"{landmark_name}\". "
            f"Note: Inferred from landmark search, not verified by camera GPS metadata."
        )
    else:
        photo["warning"] = "Manually placed on map by user."

    photo["address"] = data.get("address") or reverse_geocode(photo["latitude"], photo["longitude"])

    save_db()
    return jsonify({"success": True, "photo": photo})


@app.route("/api/photos/<photo_id>", methods=["DELETE"])
def delete_photo(photo_id):
    if photo_id not in photos_db:
        return jsonify({"error": "Photo not found"}), 404

    del photos_db[photo_id]
    for p in UPLOAD_DIR.glob(f"*{photo_id}*"):
        try:
            p.unlink()
        except Exception:
            pass

    save_db()
    return jsonify({"success": True, "deleted": photo_id})


@app.route("/api/clear", methods=["POST"])
def clear_all():
    global photos_db
    photos_db = {}
    for p in UPLOAD_DIR.glob("*"):
        if p.name != "photos_db.json":
            try:
                p.unlink()
            except Exception:
                pass
    save_db()
    return jsonify({"success": True, "cleared": True})


@app.route("/api/export/geojson", methods=["GET"])
def export_geojson():
    features = []
    for p in photos_db.values():
        if p.get("latitude") is not None and p.get("longitude") is not None:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [p["longitude"], p["latitude"]]
                },
                "properties": {
                    "id": p["id"],
                    "filename": p["filename"],
                    "location_source": p["location_source"],
                    "landmark_name": p.get("landmark_name"),
                    "warning": p.get("warning"),
                    "address": p.get("address"),
                    "date_taken": p.get("date_taken"),
                    "camera": f"{p.get('camera_make') or ''} {p.get('camera_model') or ''}".strip(),
                    "thumb_url": p["thumb_url"],
                    "preview_url": p["preview_url"]
                }
            })

    geojson = {
        "type": "FeatureCollection",
        "features": features
    }
    return jsonify(geojson)


from video_renderer import start_video_rendering, video_jobs

@app.route("/api/render-video", methods=["POST"])
def render_video():
    data = request.get_json() or {}
    waypoints = data.get("waypoints", [])
    if not waypoints or len(waypoints) < 1:
        return jsonify({"error": "At least 1 waypoint required"}), 400

    title = data.get("title", "Photo Map Tour")
    resolution = data.get("resolution", "4k")
    fps = int(data.get("fps", 30))
    map_style = data.get("map_style", "satellite")

    job_id = start_video_rendering(
        waypoints,
        photos_db,
        title=title,
        resolution=resolution,
        fps=fps,
        map_style=map_style
    )
    return jsonify({"success": True, "job_id": job_id})


@app.route("/api/video-status/<job_id>", methods=["GET"])
def video_status(job_id):
    if job_id not in video_jobs:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(video_jobs[job_id])


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting PhotoMap Server on port {port} ...")
    app.run(host="0.0.0.0", port=port, debug=False)
