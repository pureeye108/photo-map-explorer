import os
import math
import time
import uuid
import urllib.request
import subprocess
import threading
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

TILE_CACHE_DIR = Path(__file__).resolve().parent / "static" / "uploads" / "tile_cache"
VIDEO_DIR = Path(__file__).resolve().parent / "static" / "uploads" / "videos"
TILE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
VIDEO_DIR.mkdir(parents=True, exist_ok=True)

TILE_URLS = {
    "osm": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "satellite": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "dark": "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
}

video_jobs = {}


def get_tile(style, z, x, y):
    """
    Downloads and caches map tile images.
    """
    max_tiles = 2 ** z
    x = x % max_tiles
    if y < 0 or y >= max_tiles:
        return Image.new("RGB", (256, 256), (15, 23, 42))

    cache_file = TILE_CACHE_DIR / f"{style}_{z}_{x}_{y}.png"
    if cache_file.exists():
        try:
            return Image.open(cache_file).convert("RGB")
        except Exception:
            pass

    template = TILE_URLS.get(style, TILE_URLS["osm"])
    url = template.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": "PhotoMapExplorer/1.0 (4k-video-renderer)"})

    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = resp.read()
            with open(cache_file, "wb") as f:
                f.write(data)
            return Image.open(cache_file).convert("RGB")
    except Exception:
        # Return neutral background on tile network failure
        return Image.new("RGB", (256, 256), (30, 41, 59) if style != "satellite" else (10, 20, 30))


def latlon_to_pixel(lat, lon, zoom):
    tile_size = 256
    n = 2.0 ** zoom
    x = (lon + 180.0) / 360.0 * (tile_size * n)
    lat_rad = math.radians(lat)
    lat_rad = max(min(lat_rad, 1.4844), -1.4844)  # Clamp to approx 85 deg
    y = (1.0 - math.log(math.tan(lat_rad) + (1.0 / math.cos(lat_rad))) / math.pi) / 2.0 * (tile_size * n)
    return x, y


def render_stitched_map(center_lat, center_lon, zoom_float, width, height, style="satellite"):
    """
    Stitches map tiles around (center_lat, center_lon) at zoom_float into a (width, height) PIL Image.
    """
    int_zoom = int(math.floor(zoom_float))
    int_zoom = max(1, min(int_zoom, 18))
    scale = 2.0 ** (zoom_float - int_zoom)

    # Pixel coords of center in base int_zoom coordinates
    center_x, center_y = latlon_to_pixel(center_lat, center_lon, int_zoom)

    # Viewport dimensions scaled down to int_zoom scale
    vp_w = width / scale
    vp_h = height / scale

    min_x = center_x - vp_w / 2.0
    max_x = center_x + vp_w / 2.0
    min_y = center_y - vp_h / 2.0
    max_y = center_y + vp_h / 2.0

    start_tile_x = int(math.floor(min_x / 256.0))
    end_tile_x = int(math.floor(max_x / 256.0))
    start_tile_y = int(math.floor(min_y / 256.0))
    end_tile_y = int(math.floor(max_y / 256.0))

    canvas_w = (end_tile_x - start_tile_x + 1) * 256
    canvas_h = (end_tile_y - start_tile_y + 1) * 256
    int_canvas = Image.new("RGB", (canvas_w, canvas_h), (15, 23, 42))

    for tx in range(start_tile_x, end_tile_x + 1):
        for ty in range(start_tile_y, end_tile_y + 1):
            tile = get_tile(style, int_zoom, tx, ty)
            px = (tx - start_tile_x) * 256
            py = (ty - start_tile_y) * 256
            int_canvas.paste(tile, (px, py))

    # Crop exact viewport at int_zoom
    crop_left = min_x - (start_tile_x * 256)
    crop_top = min_y - (start_tile_y * 256)
    crop_right = crop_left + vp_w
    crop_bottom = crop_top + vp_h

    cropped = int_canvas.crop((int(crop_left), int(crop_top), int(crop_right), int(crop_bottom)))
    resized = cropped.resize((width, height), Image.Resampling.BILINEAR)

    return resized


def draw_pin(draw, x, y, size=60, color=(16, 185, 129), border=(255, 255, 255)):
    """
    Draws a map location pin with shadow.
    """
    r = size // 2
    # Shadow
    draw.ellipse([x - r + 4, y - r + 6, x + r + 4, y + r + 6], fill=(0, 0, 0, 100))
    # Border
    draw.ellipse([x - r, y - r, x + r, y + r], fill=border)
    # Core
    inner_r = r - 4
    draw.ellipse([x - inner_r, y - inner_r, x + inner_r, y + inner_r], fill=color)
    # Inner dot
    dot_r = inner_r // 3
    draw.ellipse([x - dot_r, y - dot_r, x + dot_r, y + dot_r], fill=(255, 255, 255))


def render_photo_card(img, photo, card_w=1000, card_h=1300, pos=(120, 200), opacity=1.0):
    """
    Renders a 4K broadcast photo spotlight card on top of the frame.
    """
    if opacity <= 0.0:
        return

    x, y = pos
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    # Card background (rounded dark glassmorphic box)
    card_alpha = int(230 * opacity)
    d.rounded_rectangle([x, y, x + card_w, y + card_h], radius=32, fill=(15, 23, 42, card_alpha), outline=(51, 65, 85, card_alpha), width=3)

    # Load preview photo
    preview_url = photo.get("preview_url") or ""
    filename = preview_url.split("/")[-1]
    photo_path = Path(__file__).resolve().parent / "static" / "uploads" / filename

    if photo_path.exists():
        try:
            p_img = Image.open(photo_path).convert("RGB")
            # Fit inside top 65% of card
            p_w = card_w - 40
            p_h = int(card_h * 0.65)
            p_img.thumbnail((p_w, p_h), Image.Resampling.LANCZOS)

            # Paste photo
            px = x + (card_w - p_img.width) // 2
            py = y + 20
            overlay.paste(p_img, (px, py))
        except Exception:
            pass

    # Location Badge
    badge_y = y + int(card_h * 0.70)
    is_gps = photo.get("location_source") == "gps"
    is_landmark = photo.get("location_source") == "landmark"

    badge_color = (16, 185, 129, int(240 * opacity)) if is_gps else (245, 158, 11, int(240 * opacity))
    badge_text = "VERIFIED GPS LOCATION" if is_gps else "ESTIMATED LANDMARK"

    d.rounded_rectangle([x + 24, badge_y, x + 380, badge_y + 44], radius=12, fill=badge_color)
    d.text((x + 40, badge_y + 10), badge_text, fill=(255, 255, 255, int(255 * opacity)))

    # Title & Address
    title = photo.get("landmark_name") or photo.get("filename") or "Location"
    address = photo.get("address") or f"{photo.get('latitude', 0):.4f}, {photo.get('longitude', 0):.4f}"

    d.text((x + 24, badge_y + 60), title[:40], fill=(255, 255, 255, int(255 * opacity)))
    d.text((x + 24, badge_y + 110), address[:60], fill=(148, 163, 184, int(240 * opacity)))

    # Camera Specs
    cam_str = " • ".join(filter(None, [
        photo.get("camera_model"),
        photo.get("focal_length"),
        photo.get("f_number"),
        photo.get("exposure_time"),
        photo.get("iso")
    ]))
    if cam_str:
        d.text((x + 24, badge_y + 160), cam_str[:60], fill=(203, 213, 225, int(200 * opacity)))

    # If landmark, draw warning line
    if is_landmark:
        d.text((x + 24, badge_y + 200), "Warning: Location visually estimated from landmark recognition", fill=(252, 211, 77, int(230 * opacity)))

    # Composite onto base image
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))


def generate_video_job(job_id, waypoints, photos_dict, title="Photo Map Tour", resolution="4k", fps=30, map_style="satellite"):
    """
    Background worker that renders the full 4K YouTube-ready video.
    """
    global video_jobs
    job = video_jobs[job_id]

    width, height = (3840, 2160) if resolution == "4k" else (1920, 1080)
    output_filename = f"tour_{job_id}.mp4"
    output_path = VIDEO_DIR / output_filename

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg_exe, "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{width}x{height}",
        "-pix_fmt", "rgb24",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "faster",
        "-crf", "18",
        str(output_path)
    ]

    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Plan trajectory between waypoints
        # Each waypoint has (lat, lon, zoom, duration, photo_id)
        total_frames = 0
        segments = []

        for i, wp in enumerate(waypoints):
            duration = max(1.5, float(wp.get("duration", 3.0)))
            hold_frames = int(duration * fps)

            # Flight to this waypoint (except first one)
            flight_frames = 0
            if i > 0:
                flight_duration = max(2.0, min(5.0, math.sqrt(
                    (wp["lat"] - waypoints[i-1]["lat"])**2 + (wp["lon"] - waypoints[i-1]["lon"])**2
                ) * 0.1 + 2.0))
                flight_frames = int(flight_duration * fps)

            segments.append({
                "wp": wp,
                "flight_frames": flight_frames,
                "hold_frames": hold_frames
            })
            total_frames += flight_frames + hold_frames

        # Intro title frames (1.5s)
        intro_frames = int(1.5 * fps)
        total_frames += intro_frames

        job["total_frames"] = total_frames
        job["current_frame"] = 0

        # 1. Render Intro
        first_wp = waypoints[0]
        intro_bg = render_stitched_map(first_wp["lat"], first_wp["lon"], first_wp.get("zoom", 12), width, height, map_style)

        for f in range(intro_frames):
            frame = intro_bg.copy()
            # Fade title in and out
            alpha = math.sin((f / intro_frames) * math.pi)
            if alpha > 0.1:
                ov = Image.new("RGBA", (width, height), (0, 0, 0, 0))
                d = ImageDraw.Draw(ov)
                d.rounded_rectangle([width//4, height//2 - 120, width*3//4, height//2 + 120], radius=32, fill=(15, 23, 42, int(220 * alpha)))
                d.text((width//2 - 350, height//2 - 50), title[:40], fill=(255, 255, 255, int(255 * alpha)))
                d.text((width//2 - 200, height//2 + 30), "4K Cinematic Travel Map Tour", fill=(52, 211, 153, int(255 * alpha)))
                frame = Image.alpha_composite(frame.convert("RGBA"), ov).convert("RGB")

            proc.stdin.write(frame.tobytes())
            job["current_frame"] += 1
            job["progress"] = int((job["current_frame"] / total_frames) * 100)

        # 2. Render Waypoints and Flights
        history_points = []

        for seg_idx, seg in enumerate(segments):
            wp = seg["wp"]
            prev_wp = segments[seg_idx - 1]["wp"] if seg_idx > 0 else wp
            photo = photos_dict.get(wp.get("photo_id"))

            # --- FLIGHT PHASE ---
            flight_n = seg["flight_frames"]
            for f in range(flight_n):
                t = f / float(flight_n)
                # Smooth cosine ease
                ease_t = (1.0 - math.cos(t * math.pi)) / 2.0

                cur_lat = prev_wp["lat"] + (wp["lat"] - prev_wp["lat"]) * ease_t
                cur_lon = prev_wp["lon"] + (wp["lon"] - prev_wp["lon"]) * ease_t

                # Dynamic zoom: pull out slightly during mid-flight for cinematic scale
                z_start = float(prev_wp.get("zoom", 14))
                z_end = float(wp.get("zoom", 14))
                z_dip = min(z_start, z_end) - 1.5 * math.sin(t * math.pi)
                cur_zoom = (z_start + (z_end - z_start) * ease_t) * (1 - 0.2 * math.sin(t * math.pi))
                cur_zoom = max(2.0, cur_zoom)

                frame = render_stitched_map(cur_lat, cur_lon, cur_zoom, width, height, map_style)

                # Draw past pins
                draw = ImageDraw.Draw(frame)
                for h in history_points:
                    hx, hy = latlon_to_pixel(h["lat"], h["lon"], int(math.floor(cur_zoom)))
                    # Compute relative to center
                    cx, cy = latlon_to_pixel(cur_lat, cur_lon, int(math.floor(cur_zoom)))
                    scale = 2.0 ** (cur_zoom - math.floor(cur_zoom))
                    px = width / 2.0 + (hx - cx) * scale
                    py = height / 2.0 + (hy - cy) * scale
                    if 0 <= px <= width and 0 <= py <= height:
                        draw_pin(draw, int(px), int(py), size=40, color=(59, 130, 246))

                # Draw current pin at center
                draw_pin(draw, width // 2, height // 2, size=56, color=(16, 185, 129) if wp.get("source") == "gps" else (245, 158, 11))

                proc.stdin.write(frame.tobytes())
                job["current_frame"] += 1
                job["progress"] = int((job["current_frame"] / total_frames) * 100)

            # Record this waypoint to history
            history_points.append(wp)

            # --- HOLD PHASE (Photo Spotlight) ---
            hold_n = seg["hold_frames"]
            base_frame = render_stitched_map(wp["lat"], wp["lon"], float(wp.get("zoom", 14)), width, height, map_style)
            draw = ImageDraw.Draw(base_frame)
            draw_pin(draw, width // 2, height // 2, size=60, color=(16, 185, 129) if wp.get("source") == "gps" else (245, 158, 11))

            for f in range(hold_n):
                frame = base_frame.copy()
                # Fade in card over first 0.5s
                card_t = min(1.0, f / float(fps * 0.5)) if f < hold_n - (fps * 0.5) else max(0.0, (hold_n - f) / float(fps * 0.5))

                if photo:
                    render_photo_card(frame, photo, card_w=int(width * 0.28), card_h=int(height * 0.70), pos=(int(width * 0.05), int(height * 0.15)), opacity=card_t)

                proc.stdin.write(frame.tobytes())
                job["current_frame"] += 1
                job["progress"] = int((job["current_frame"] / total_frames) * 100)

        proc.stdin.close()
        proc.wait()

        job["status"] = "completed"
        job["progress"] = 100
        job["video_url"] = f"/static/uploads/videos/{output_filename}"
        job["filename"] = output_filename

    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)


def start_video_rendering(waypoints, photos_dict, title="Photo Map Tour", resolution="4k", fps=30, map_style="satellite"):
    job_id = str(uuid.uuid4())[:8]
    video_jobs[job_id] = {
        "id": job_id,
        "status": "rendering",
        "progress": 0,
        "created_at": time.time(),
        "video_url": None,
        "error": None
    }

    t = threading.Thread(
        target=generate_video_job,
        args=(job_id, waypoints, photos_dict, title, resolution, fps, map_style),
        daemon=True
    )
    t.start()
    return job_id
