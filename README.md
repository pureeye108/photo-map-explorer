---
title: PhotoMap Explorer
emoji: 🗺️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# PhotoMap Explorer 🗺️📸

A modern web application to map your photos (JPEG, PNG, HEIC, TIFF, and camera RAW files) on an interactive map, take map screenshots, and create cinematic **YouTube 4K travel flight videos**.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/pureeye108/photo-map-explorer)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Showcase-3b82f6?logo=github)](https://pureeye108.github.io/photo-map-explorer/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**[🌐 Visit the Live Showcase Website](https://pureeye108.github.io/photo-map-explorer/)**

---

## Features

### 1. Broad Image & Camera RAW Support
- **Standard**: `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif`, `.tiff`
- **Camera RAW**: Canon (`.cr2`, `.cr3`), Nikon (`.nef`), Sony (`.arw`), Adobe (`.dng`), Olympus (`.orf`), Panasonic (`.rw2`), Fujifilm (`.raf`), Pentax (`.pef`)
- Ultra-fast thumbnail extraction directly from embedded RAW preview buffers.

### 2. EXIF GPS Mapping & Zero-API Landmark Detection
- **With GPS**: Extracts latitude, longitude, and altitude, placing a **✓ Verified GPS** marker (Green).
- **Without GPS**:
  - Automatically matches place keywords from filenames (e.g. `Eiffel_Tower_01.jpg` $\rightarrow$ Paris, France).
  - Built-in **Free Landmark Search** modal powered by OpenStreetMap Nominatim (100% free, zero API key needed).
  - Plots with an **⚠️ Estimated Landmark** marker and warning indicator.
  - Optional: Google Gemini Vision AI support if you enter a free Gemini key in Settings.
- **Manual Pin Placement**: Click anywhere on the map to manually set or adjust coordinates.

### 3. Map & Locations Screenshot Tool
- Capture high-resolution snapshots of the map with pins and photo thumbnails.
- Optional custom title banner (e.g. *"European Tour 2024"*) and date watermark.
- Instant 1-click **Download PNG** or **Copy to Clipboard**.

### 4. YouTube 4K Video Tour Studio
- Build flight tours connecting your mapped photos.
- Rehearse camera flights with real-time in-browser preview (**▶ Preview Flight**).
- Render broadcast-quality **YouTube 4K UHD (3840 x 2160)** MP4 videos powered by FFmpeg:
  - Smooth camera flights and glowing route trails.
  - High-res photo spotlight cards with camera EXIF details and location badges.
  - Built-in player and direct `.mp4` download.

---

## Running Locally

### Windows
Double-click **`run.bat`** (or run `python app.py` in your terminal).
The app will start at `http://127.0.0.1:5000`.

### Linux / Mac
```bash
pip install -r requirements.txt
python app.py
```

---

## Deploying to the Web (Free)

### 1-Click Deploy on Render.com (Recommended)
Anyone can deploy their own instance with 1 click:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/pureeye108/photo-map-explorer)

1. Click the **Deploy to Render** button above.
2. Sign in to Render with your GitHub account.
3. Render automatically detects `render.yaml` and `Dockerfile`, builds FFmpeg, and provides a free HTTPS web link!

---

## Activating GitHub Pages Showcase

This repository includes a showcase website in `/docs`:
1. Go to your GitHub repository: **Settings** $\rightarrow$ **Pages** (on the left menu).
2. Under **Build and deployment** $\rightarrow$ **Branch**:
   - Select **`main`**
   - Select folder **`/docs`**
3. Click **Save**.
4. Your showcase page will be published at:  
   **`https://pureeye108.github.io/photo-map-explorer/`**

