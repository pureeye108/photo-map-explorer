// State
let map;
let markerClusterGroup;
let photoMarkers = new Map(); // photo_id -> L.Marker
let photos = [];
let activePhotoIndex = -1;
let currentFilter = 'all';
let currentTileLayer = null;
let tileLayers = {};
let manualPlacingPhotoId = null;

// Config from localStorage
let geminiApiKey = localStorage.getItem('photo_map_gemini_key') || '';
let autoDetectLandmarks = localStorage.getItem('photo_map_autodetect') === 'true';

// Document Ready
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initDragDrop();
  initEventListeners();
  loadSavedSettings();
  fetchPhotos();
});

// Map Initialization
function initMap() {
  map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    zoomControl: false,
  });

  // Zoom control top-left
  L.control.zoom({ position: 'topleft' }).addTo(map);

  // Base tile layers
  tileLayers.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });

  tileLayers.dark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16,
    crossOrigin: true,
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
  });

  tileLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    crossOrigin: true,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  });

  // Default layer
  const savedLayer = localStorage.getItem('photo_map_layer') || 'osm';
  setMapLayer(savedLayer);

  // Marker cluster group with smooth anim
  markerClusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    chunkedLoading: true
  });
  map.addLayer(markerClusterGroup);

  // Map click for manual placement
  map.on('click', (e) => {
    if (manualPlacingPhotoId) {
      applyManualPlacement(manualPlacingPhotoId, e.latlng.lat, e.latlng.lng);
    }
  });
}

function setMapLayer(name) {
  if (!tileLayers[name]) name = 'osm';
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  currentTileLayer = tileLayers[name];
  map.addLayer(currentTileLayer);
  localStorage.setItem('photo_map_layer', name);

  // Update buttons styling
  ['osm', 'dark', 'satellite'].forEach(id => {
    const btn = document.getElementById(`layer-${id}`);
    if (btn) {
      if (id === name) {
        btn.className = "px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-medium transition shadow";
      } else {
        btn.className = "px-2.5 py-1.5 rounded-lg text-slate-300 hover:bg-slate-800 transition";
      }
    }
  });
}

// Fetch photos from server
async function fetchPhotos() {
  try {
    const res = await fetch('/api/photos');
    photos = await res.json();
    renderAll();
  } catch (err) {
    console.error('Failed to load photos:', err);
  }
}

// Render markers, stats, and photo tray
function renderAll() {
  updateStats();
  renderMarkers();
  renderTray();
}

function updateStats() {
  const total = photos.length;
  const gps = photos.filter(p => p.location_source === 'gps').length;
  const landmark = photos.filter(p => p.location_source === 'landmark').length;
  const none = photos.filter(p => p.latitude === null || p.longitude === null).length;

  document.getElementById('count-all').textContent = total;
  document.getElementById('count-gps').textContent = gps;
  document.getElementById('count-landmark').textContent = landmark;
  document.getElementById('count-none').textContent = none;

  const btnBatch = document.getElementById('btn-batch-landmark');
  if (btnBatch) {
    btnBatch.disabled = none === 0;
  }
}

function renderMarkers() {
  markerClusterGroup.clearLayers();
  photoMarkers.clear();

  const filtered = getFilteredPhotos();
  const bounds = [];

  filtered.forEach(photo => {
    if (photo.latitude !== null && photo.longitude !== null) {
      const marker = createPhotoMarker(photo);
      markerClusterGroup.addLayer(marker);
      photoMarkers.set(photo.id, marker);
      bounds.push([photo.latitude, photo.longitude]);
    }
  });

  if (bounds.length > 0 && !manualPlacingPhotoId) {
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  }
}

function createPhotoMarker(photo) {
  const isGPS = photo.location_source === 'gps';
  const isLandmark = photo.location_source === 'landmark';
  const isManual = photo.location_source === 'manual';

  let badgeType = 'none';
  let badgeIcon = '<i class="fa-solid fa-question"></i>';

  if (isGPS) {
    badgeType = 'gps';
    badgeIcon = '<i class="fa-solid fa-satellite"></i>';
  } else if (isLandmark) {
    badgeType = 'landmark';
    badgeIcon = '<i class="fa-solid fa-triangle-exclamation"></i>';
  } else if (isManual) {
    badgeType = 'manual';
    badgeIcon = '<i class="fa-solid fa-map-pin"></i>';
  }

  const iconHtml = `
    <div class="custom-pin">
      <div class="pin-bubble ${badgeType}" style="background-image: url('${photo.thumb_url}')"></div>
      <div class="pin-badge ${badgeType}">
        ${badgeIcon}
      </div>
    </div>
  `;

  const customIcon = L.divIcon({
    html: iconHtml,
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22]
  });

  const marker = L.marker([photo.latitude, photo.longitude], { icon: customIcon });
  marker.bindPopup(() => createPopupContent(photo), { maxWidth: 360 });

  return marker;
}

function createPopupContent(photo) {
  const isGPS = photo.location_source === 'gps';
  const isLandmark = photo.location_source === 'landmark';

  let bannerHtml = '';
  if (isGPS) {
    bannerHtml = `
      <div class="bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 rounded-xl p-2.5 mb-3 flex items-start gap-2 text-xs">
        <i class="fa-solid fa-circle-check text-emerald-600 mt-0.5 text-sm"></i>
        <div>
          <strong class="font-semibold text-emerald-700 block">Verified GPS Location</strong>
          <span class="text-slate-600 text-[11px]">Directly from camera EXIF GPS metadata</span>
        </div>
      </div>
    `;
  } else if (isLandmark) {
    bannerHtml = `
      <div class="bg-amber-500/15 border border-amber-500/40 text-amber-900 rounded-xl p-2.5 mb-3 flex items-start gap-2 text-xs">
        <i class="fa-solid fa-triangle-exclamation text-amber-600 mt-0.5 text-sm"></i>
        <div>
          <strong class="font-bold text-amber-700 block">⚠️ ESTIMATED LOCATION</strong>
          <div class="text-amber-900 font-semibold text-[11px] mb-0.5">Landmark: ${photo.landmark_name || 'Visual Site'}</div>
          <p class="text-slate-600 text-[10px] leading-tight">
            ${photo.warning || 'Estimated from landmark recognition. Not verified by camera GPS.'}
          </p>
          ${photo.landmark_reasoning ? `<p class="text-slate-500 text-[9px] mt-1 italic">${photo.landmark_reasoning}</p>` : ''}
        </div>
      </div>
    `;
  } else {
    bannerHtml = `
      <div class="bg-blue-500/10 border border-blue-500/30 text-blue-800 rounded-xl p-2 mb-3 text-xs">
        <i class="fa-solid fa-map-pin text-blue-600 mr-1"></i> Manually placed by user
      </div>
    `;
  }

  const cameraStr = [
    photo.camera_make,
    photo.camera_model,
    photo.focal_length,
    photo.f_number,
    photo.exposure_time,
    photo.iso
  ].filter(Boolean).join(' • ');

  const isRaw = photo.file_type === 'raw';

  return `
    <div class="text-slate-800 font-sans p-4 select-text">
      <!-- Thumbnail Header -->
      <div class="relative h-44 w-full rounded-xl overflow-hidden mb-3 bg-slate-900 cursor-pointer group" onclick="openLightboxById('${photo.id}')">
        <img src="${photo.preview_url}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105" alt="${photo.filename}">
        <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
        <div class="absolute bottom-2 left-2 right-2 flex justify-between items-end">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isRaw ? 'bg-purple-600 text-white' : 'bg-slate-800 text-white'}">
            ${isRaw ? 'RAW ' + photo.extension.toUpperCase() : photo.extension.toUpperCase()}
          </span>
          <span class="text-[11px] text-white/90 bg-black/40 px-2 py-0.5 rounded backdrop-blur-sm">
            <i class="fa-regular fa-eye mr-1"></i> Expand
          </span>
        </div>
      </div>

      <!-- Warning or Status Banner -->
      ${bannerHtml}

      <!-- Filename & Address -->
      <h4 class="font-bold text-sm text-slate-900 truncate mb-1" title="${photo.filename}">${photo.filename}</h4>
      <p class="text-xs text-slate-500 mb-2 flex items-start gap-1.5">
        <i class="fa-solid fa-location-dot text-slate-400 mt-0.5"></i>
        <span class="leading-tight">${photo.address || `${photo.latitude.toFixed(4)}, ${photo.longitude.toFixed(4)}`}</span>
      </p>

      <!-- EXIF Summary -->
      ${cameraStr ? `
        <p class="text-[11px] text-slate-400 bg-slate-100 p-2 rounded-lg mb-3">
          <i class="fa-solid fa-camera mr-1"></i> ${cameraStr}
        </p>
      ` : ''}

      <!-- Buttons -->
      <div class="flex items-center gap-2 pt-2 border-t border-slate-100">
        <button onclick="openLightboxById('${photo.id}')" class="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition">
          <i class="fa-solid fa-expand"></i> Inspect
        </button>
        <button onclick="startManualPlacement('${photo.id}')" title="Adjust pin" class="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition">
          <i class="fa-solid fa-arrows-up-down-left-right"></i>
        </button>
        <button onclick="deletePhoto('${photo.id}')" title="Delete" class="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs transition">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </div>
    </div>
  `;
}

function renderTray() {
  const container = document.getElementById('cards-container');
  const filtered = getFilteredPhotos();

  if (photos.length === 0) {
    container.innerHTML = `
      <div id="empty-state" class="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2 select-none">
        <i class="fa-solid fa-cloud-arrow-up text-3xl text-slate-600"></i>
        <p class="text-sm">Drag & drop photos here, or click <strong>Upload Photos</strong></p>
        <p class="text-xs text-slate-600">Supports JPEG, RAW (CR2, NEF, ARW, DNG, RAF), PNG, HEIC</p>
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-1 select-none">
        <p class="text-sm">No photos match the filter "<strong>${currentFilter.toUpperCase()}</strong>"</p>
        <button onclick="filterPhotos('all')" class="text-xs text-emerald-400 underline">Show all photos</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const isGPS = p.location_source === 'gps';
    const isLandmark = p.location_source === 'landmark';
    const isNone = p.latitude === null || p.longitude === null;
    const isRaw = p.file_type === 'raw';

    let badgeClass = 'bg-slate-700 text-slate-300';
    let badgeLabel = 'No Location';

    if (isGPS) {
      badgeClass = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
      badgeLabel = '<i class="fa-solid fa-satellite mr-1"></i> GPS';
    } else if (isLandmark) {
      badgeClass = 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      badgeLabel = '<i class="fa-solid fa-triangle-exclamation mr-1"></i> Landmark ⚠️';
    }

    return `
      <div class="photo-card relative flex-shrink-0 w-44 h-48 bg-slate-800 rounded-2xl overflow-hidden border border-slate-700/70 cursor-pointer flex flex-col group" onclick="focusPhoto('${p.id}')">
        <!-- Thumbnail -->
        <div class="relative h-28 w-full bg-slate-900 overflow-hidden">
          <img src="${p.thumb_url}" alt="${p.filename}" class="w-full h-full object-cover transition duration-300 group-hover:scale-105" loading="lazy">
          <span class="absolute top-2 left-2 text-[9px] font-bold px-1.5 py-0.5 rounded ${isRaw ? 'bg-purple-600 text-white' : 'bg-black/60 text-slate-200'}">
            ${isRaw ? 'RAW' : p.extension.toUpperCase().replace('.', '')}
          </span>
          <button onclick="event.stopPropagation(); deletePhoto('${p.id}')" class="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>

        <!-- Info -->
        <div class="p-2 flex-1 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] px-1.5 py-0.2 rounded font-semibold ${badgeClass}">
                ${badgeLabel}
              </span>
            </div>
            <p class="text-xs font-semibold text-slate-200 truncate" title="${p.filename}">${p.filename}</p>
            <p class="text-[10px] text-slate-400 truncate">${p.landmark_name || p.address || 'Click to locate'}</p>
          </div>

          <!-- Unlocated quick actions -->
          ${isNone ? `
            <div class="flex gap-1 mt-1" onclick="event.stopPropagation()">
              <button onclick="detectLandmark('${p.id}')" class="flex-1 py-1 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-white text-[10px] font-medium transition" title="Run AI landmark recognition">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Detect
              </button>
              <button onclick="startManualPlacement('${p.id}')" class="flex-1 py-1 rounded-lg bg-blue-600/80 hover:bg-blue-500 text-white text-[10px] font-medium transition" title="Place on map">
                <i class="fa-solid fa-map-pin"></i> Pin
              </button>
            </div>
          ` : `
            <div class="flex justify-between items-center text-[10px] text-slate-500 mt-1">
              <span>${p.date_taken ? p.date_taken.split(' ')[0].replace(/:/g, '-') : ''}</span>
              <span class="text-emerald-400 group-hover:underline">View on map &rarr;</span>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function getFilteredPhotos() {
  if (currentFilter === 'gps') {
    return photos.filter(p => p.location_source === 'gps');
  } else if (currentFilter === 'landmark') {
    return photos.filter(p => p.location_source === 'landmark');
  } else if (currentFilter === 'none') {
    return photos.filter(p => p.latitude === null || p.longitude === null);
  }
  return photos;
}

function filterPhotos(filter) {
  currentFilter = filter;
  // Update tray buttons
  document.querySelectorAll('.tray-filter').forEach(btn => {
    if (btn.dataset.filter === filter) {
      btn.className = "tray-filter active px-2.5 py-0.5 rounded-md text-xs font-medium text-slate-200 bg-slate-800";
    } else {
      btn.className = "tray-filter px-2.5 py-0.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200";
    }
  });

  renderMarkers();
  renderTray();
}

function focusPhoto(id) {
  const photo = photos.find(p => p.id === id);
  if (!photo) return;

  if (photo.latitude !== null && photo.longitude !== null) {
    map.flyTo([photo.latitude, photo.longitude], 16, { duration: 1.2 });
    setTimeout(() => {
      const marker = photoMarkers.get(id);
      if (marker) {
        markerClusterGroup.zoomToShowLayer(marker, () => {
          marker.openPopup();
        });
      }
    }, 400);
  } else {
    // Open lightbox directly to allow inspection/detecting
    openLightboxById(id);
  }
}

// Drag & Drop Handling
function initDragDrop() {
  const overlay = document.getElementById('drag-drop-overlay');
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.remove('hidden');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay.classList.add('hidden');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.add('hidden');

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesUpload(e.dataTransfer.files);
    }
  });
}

function initEventListeners() {
  // File & Folder input
  const fileInput = document.getElementById('file-input');
  const folderInput = document.getElementById('folder-input');

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesUpload(e.target.files);
      fileInput.value = '';
    }
  });

  folderInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesUpload(e.target.files);
      folderInput.value = '';
    }
  });

  // Keyboard navigation for modals
  window.addEventListener('keydown', (e) => {
    const lm = document.getElementById('landmark-modal');
    if (lm && !lm.classList.contains('hidden')) {
      if (e.key === 'Escape') closeLandmarkModal();
      return;
    }

    const lb = document.getElementById('lightbox-modal');
    if (lb && !lb.classList.contains('hidden')) {
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      else if (e.key === 'ArrowRight') navigateLightbox(1);
      else if (e.key === 'Escape') closeLightbox();
    } else if (e.key === 'Escape' && manualPlacingPhotoId) {
      cancelManualPlacement();
    }
  });

  const lmSearchInput = document.getElementById('lm-search-input');
  if (lmSearchInput) {
    lmSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeLandmarkSearch();
      }
    });
  }

  // Close menus when clicking outside
  window.addEventListener('click', (e) => {
    const menu = document.getElementById('upload-menu');
    if (menu && !menu.classList.contains('hidden') && !e.target.closest('.group')) {
      menu.classList.add('hidden');
    }
  });
}

function toggleUploadMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('upload-menu');
  menu.classList.toggle('hidden');
}

function hideUploadMenu() {
  const menu = document.getElementById('upload-menu');
  if (menu) menu.classList.add('hidden');
}

// Upload Files in Batches
async function handleFilesUpload(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  showProgressToast(true, 'Uploading Photos...', 0, `Uploading ${files.length} file(s)...`);

  const chunkSize = 5;
  const totalChunks = Math.ceil(files.length / chunkSize);
  const newlyUploaded = [];

  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    const formData = new FormData();
    chunk.forEach(file => formData.append('files', file));

    const progressPct = Math.round((i / files.length) * 100);
    showProgressToast(true, `Uploading (${i + 1}/${files.length})...`, progressPct, `Extracting GPS & RAW metadata...`);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.photos) {
        newlyUploaded.push(...data.photos);
      }
    } catch (err) {
      console.error('Batch upload error:', err);
    }
  }

  showProgressToast(false);
  await fetchPhotos();

  // If autodetect enabled and API key is present, run detection on unlocated photos
  if (autoDetectLandmarks && geminiApiKey) {
    const unlocated = newlyUploaded.filter(p => p.latitude === null || p.longitude === null);
    if (unlocated.length > 0) {
      await batchDetectSpecific(unlocated);
    }
  }
}

function showProgressToast(visible, title = '', pct = 0, desc = '') {
  const toast = document.getElementById('progress-toast');
  if (!visible) {
    toast.classList.add('hidden');
    return;
  }
  toast.classList.remove('hidden');
  document.getElementById('progress-title').innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${title}`;
  document.getElementById('progress-percent').textContent = `${pct}%`;
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.getElementById('progress-desc').textContent = desc;
}

// Landmark Detection (Supports both Zero-API search and optional Gemini AI)
let activeLandmarkPhotoId = null;

async function detectLandmark(photoId) {
  const photo = photos.find(p => p.id === photoId);
  if (!photo) return;

  // If Gemini API Key is configured, attempt Vision AI
  if (geminiApiKey) {
    showProgressToast(true, 'AI Landmark Detection', 50, `Analyzing visual landmarks for ${photo.filename}...`);
    try {
      const res = await fetch('/api/detect-landmark', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gemini-Key': geminiApiKey
        },
        body: JSON.stringify({ photo_id: photoId, api_key: geminiApiKey })
      });
      const data = await res.json();
      showProgressToast(false);
      if (data.success && data.detected) {
        const idx = photos.findIndex(p => p.id === photoId);
        if (idx !== -1) photos[idx] = data.photo;
        renderAll();
        focusPhoto(photoId);
        return;
      }
    } catch (err) {
      console.warn('Gemini detection error, falling back to search:', err);
      showProgressToast(false);
    }
  }

  // Zero-API Mode: Test filename keyword first
  showProgressToast(true, 'Locating Landmark', 50, `Checking place keywords for ${photo.filename}...`);
  try {
    const res = await fetch('/api/detect-landmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_id: photoId })
    });
    const data = await res.json();
    showProgressToast(false);

    if (data.success && data.detected) {
      const idx = photos.findIndex(p => p.id === photoId);
      if (idx !== -1) photos[idx] = data.photo;
      renderAll();
      focusPhoto(photoId);
      return;
    } else {
      // Open free landmark finder modal with suggested query
      openLandmarkModal(photoId, data.suggested_query || '');
    }
  } catch (err) {
    showProgressToast(false);
    openLandmarkModal(photoId);
  }
}

async function batchDetectLandmarks() {
  const unlocated = photos.filter(p => p.latitude === null || p.longitude === null);
  if (unlocated.length === 0) {
    alert('All photos already have location information!');
    return;
  }

  // If Gemini API key is configured, run AI
  if (geminiApiKey) {
    await batchDetectSpecific(unlocated);
    return;
  }

  // Zero-API Batch: Search places from filenames
  let locatedCount = 0;
  for (let i = 0; i < unlocated.length; i++) {
    const p = unlocated[i];
    const pct = Math.round(((i + 1) / unlocated.length) * 100);
    showProgressToast(true, `Checking place names (${i + 1}/${unlocated.length})`, pct, `Examining ${p.filename}...`);

    try {
      const res = await fetch('/api/detect-landmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_id: p.id })
      });
      const data = await res.json();
      if (data.success && data.detected) {
        locatedCount++;
        const idx = photos.findIndex(item => item.id === p.id);
        if (idx !== -1) photos[idx] = data.photo;
        renderAll();
      }
    } catch (e) {
      console.error(e);
    }
  }

  showProgressToast(false);
  if (locatedCount > 0) {
    alert(`Located ${locatedCount} photo(s) from place keywords!\nFor any remaining photos, click "Detect" on the photo card to search any landmark for free.`);
  } else {
    // Open landmark modal for first unlocated photo
    openLandmarkModal(unlocated[0].id);
  }
}

// Zero-API Landmark Finder Modal Handlers
function openLandmarkModal(photoId, initialQuery = '') {
  closeLightbox();
  const photo = photos.find(p => p.id === photoId);
  if (!photo) return;

  activeLandmarkPhotoId = photoId;
  document.getElementById('lm-modal-filename').textContent = photo.filename;
  document.getElementById('lm-modal-thumb').src = photo.thumb_url;

  const searchInput = document.getElementById('lm-search-input');
  searchInput.value = initialQuery;

  document.getElementById('lm-search-results').innerHTML = '';
  document.getElementById('lm-search-results').classList.add('hidden');
  document.getElementById('lm-search-loading').classList.add('hidden');
  document.getElementById('lm-search-empty').classList.remove('hidden');

  document.getElementById('landmark-modal').classList.remove('hidden');

  if (initialQuery && initialQuery.length >= 3) {
    executeLandmarkSearch();
  } else {
    searchInput.focus();
  }
}

function closeLandmarkModal() {
  activeLandmarkPhotoId = null;
  document.getElementById('landmark-modal').classList.add('hidden');
}

async function executeLandmarkSearch() {
  const query = document.getElementById('lm-search-input').value.trim();
  if (!query) return;

  const loadingEl = document.getElementById('lm-search-loading');
  const emptyEl = document.getElementById('lm-search-empty');
  const resultsEl = document.getElementById('lm-search-results');

  loadingEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');
  resultsEl.classList.add('hidden');
  resultsEl.innerHTML = '';

  try {
    const res = await fetch(`/api/search-landmark?q=${encodeURIComponent(query)}`);
    const results = await res.json();

    loadingEl.classList.add('hidden');

    if (!results || results.length === 0) {
      emptyEl.textContent = `No landmark matches found for "${query}". Try another search or city name.`;
      emptyEl.classList.remove('hidden');
      return;
    }

    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = results.map(item => `
      <div onclick="selectLandmark(${item.latitude}, ${item.longitude}, '${escapeHtml(item.name)}', '${escapeHtml(item.display_name)}')" class="p-2.5 rounded-xl bg-slate-800/80 hover:bg-amber-600/20 border border-slate-700/80 hover:border-amber-500/50 cursor-pointer flex items-center justify-between transition group">
        <div class="overflow-hidden pr-2">
          <div class="text-xs font-semibold text-slate-100 group-hover:text-amber-300 flex items-center gap-1.5">
            <i class="fa-solid fa-location-dot text-amber-400 text-[11px]"></i>
            <span class="truncate">${item.name}</span>
          </div>
          <div class="text-[10px] text-slate-400 truncate mt-0.5">${item.display_name}</div>
        </div>
        <button class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-semibold flex-shrink-0 transition">
          Select
        </button>
      </div>
    `).join('');
  } catch (err) {
    loadingEl.classList.add('hidden');
    emptyEl.textContent = 'Search failed: ' + err.message;
    emptyEl.classList.remove('hidden');
  }
}

function quickPickLandmark(query) {
  document.getElementById('lm-search-input').value = query;
  executeLandmarkSearch();
}

async function selectLandmark(lat, lon, landmarkName, address) {
  if (!activeLandmarkPhotoId) return;

  const photoId = activeLandmarkPhotoId;
  closeLandmarkModal();

  try {
    const res = await fetch('/api/update-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photo_id: photoId,
        latitude: lat,
        longitude: lon,
        landmark_name: landmarkName,
        address: address,
        source: 'landmark'
      })
    });
    const data = await res.json();
    if (data.success) {
      const idx = photos.findIndex(p => p.id === photoId);
      if (idx !== -1) photos[idx] = data.photo;
      renderAll();
      focusPhoto(photoId);
    }
  } catch (err) {
    alert('Failed to place landmark: ' + err.message);
  }
}

function startManualPlacementFromModal() {
  const photoId = activeLandmarkPhotoId;
  closeLandmarkModal();
  if (photoId) {
    startManualPlacement(photoId);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

async function batchDetectSpecific(photoList) {
  let detectedCount = 0;
  for (let i = 0; i < photoList.length; i++) {
    const p = photoList[i];
    const pct = Math.round(((i + 1) / photoList.length) * 100);
    showProgressToast(true, `AI Analyzing (${i + 1}/${photoList.length})`, pct, `Examining ${p.filename}...`);

    try {
      const res = await fetch('/api/detect-landmark', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gemini-Key': geminiApiKey
        },
        body: JSON.stringify({ photo_id: p.id, api_key: geminiApiKey })
      });
      const data = await res.json();
      if (data.success && data.detected) {
        detectedCount++;
        const idx = photos.findIndex(item => item.id === p.id);
        if (idx !== -1) photos[idx] = data.photo;
        renderAll();
      }
    } catch (e) {
      console.error(e);
    }
  }

  showProgressToast(false);
  alert(`AI Landmark Analysis complete!\nIdentified locations for ${detectedCount} out of ${photoList.length} photo(s).`);
}

// Manual Placement on Map
function startManualPlacement(photoId) {
  closeLightbox();
  const photo = photos.find(p => p.id === photoId);
  if (!photo) return;

  manualPlacingPhotoId = photoId;
  document.getElementById('placement-filename').textContent = photo.filename;
  document.getElementById('placement-banner').classList.remove('hidden');
  document.getElementById('map').classList.add('placement-crosshair');
}

function cancelManualPlacement() {
  manualPlacingPhotoId = null;
  document.getElementById('placement-banner').classList.add('hidden');
  document.getElementById('map').classList.remove('placement-crosshair');
}

async function applyManualPlacement(photoId, lat, lon) {
  cancelManualPlacement();
  try {
    const res = await fetch('/api/update-location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_id: photoId, latitude: lat, longitude: lon })
    });
    const data = await res.json();
    if (data.success) {
      const idx = photos.findIndex(p => p.id === photoId);
      if (idx !== -1) photos[idx] = data.photo;
      renderAll();
      focusPhoto(photoId);
    }
  } catch (err) {
    alert('Failed to update location: ' + err.message);
  }
}

// Lightbox
function openLightboxById(photoId) {
  const filtered = getFilteredPhotos();
  const index = filtered.findIndex(p => p.id === photoId);
  if (index !== -1) {
    activePhotoIndex = index;
    updateLightboxUI();
    document.getElementById('lightbox-modal').classList.remove('hidden');
  }
}

function closeLightbox() {
  document.getElementById('lightbox-modal').classList.add('hidden');
}

function navigateLightbox(delta) {
  const filtered = getFilteredPhotos();
  if (filtered.length === 0) return;

  activePhotoIndex = (activePhotoIndex + delta + filtered.length) % filtered.length;
  updateLightboxUI();
}

function updateLightboxUI() {
  const filtered = getFilteredPhotos();
  if (activePhotoIndex < 0 || activePhotoIndex >= filtered.length) return;

  const p = filtered[activePhotoIndex];

  document.getElementById('lightbox-img').src = p.preview_url;
  document.getElementById('lb-filename').textContent = p.filename;

  const isRaw = p.file_type === 'raw';
  const formatBadge = document.getElementById('lb-format-badge');
  formatBadge.textContent = isRaw ? `RAW ${p.extension.toUpperCase()}` : p.extension.toUpperCase();
  formatBadge.className = `px-2 py-0.5 rounded text-xs font-semibold ${isRaw ? 'bg-purple-900/60 text-purple-300 border border-purple-600/50' : 'bg-slate-800 text-emerald-400 border border-slate-700'}`;

  // Status & Warning box
  const statusBox = document.getElementById('lb-status-box');
  const isGPS = p.location_source === 'gps';
  const isLandmark = p.location_source === 'landmark';

  if (isGPS) {
    statusBox.className = 'p-3 rounded-xl mb-4 text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-300';
    statusBox.innerHTML = `
      <div class="font-bold flex items-center gap-1.5 mb-1">
        <i class="fa-solid fa-satellite text-emerald-400"></i> Verified GPS Location
      </div>
      <p class="text-slate-300 text-[11px]">Direct coordinates extracted from camera EXIF GPS tags.</p>
    `;
  } else if (isLandmark) {
    statusBox.className = 'p-3 rounded-xl mb-4 text-xs bg-amber-500/20 border border-amber-500/50 text-amber-200';
    statusBox.innerHTML = `
      <div class="font-bold flex items-center gap-1.5 text-amber-300 mb-1">
        <i class="fa-solid fa-triangle-exclamation text-amber-400 text-sm"></i>
        <span>⚠️ ESTIMATED LOCATION (Landmark Identified)</span>
      </div>
      <div class="font-semibold text-white mb-1">Landmark: ${p.landmark_name}</div>
      <p class="text-slate-300 text-[11px] leading-relaxed">${p.warning}</p>
      ${p.landmark_reasoning ? `<p class="text-amber-200/80 text-[10px] mt-1 italic">${p.landmark_reasoning}</p>` : ''}
    `;
  } else {
    statusBox.className = 'p-3 rounded-xl mb-4 text-xs bg-slate-800 border border-slate-700 text-slate-300';
    statusBox.innerHTML = `
      <div class="font-bold flex items-center gap-1.5 text-slate-400 mb-1">
        <i class="fa-solid fa-question-circle"></i> No Location Found
      </div>
      <p class="text-slate-400 text-[11px]">Run AI Landmark Detection or click "Set Location on Map" to place this photo.</p>
    `;
  }

  // Metadata items
  document.getElementById('lb-date').textContent = p.date_taken || 'Unknown';
  document.getElementById('lb-location').textContent = p.address || (p.latitude ? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}` : 'Not mapped');
  document.getElementById('lb-coords').textContent = p.latitude ? `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}` : '-';
  document.getElementById('lb-camera').textContent = [p.camera_make, p.camera_model].filter(Boolean).join(' ') || '-';
  document.getElementById('lb-lens').textContent = p.lens || '-';
  document.getElementById('lb-exposure').textContent = [p.focal_length, p.f_number, p.exposure_time, p.iso].filter(Boolean).join('  ') || '-';

  // Action button states
  const btnLocate = document.getElementById('lb-btn-locate');
  if (p.latitude !== null && p.longitude !== null) {
    btnLocate.classList.remove('hidden');
  } else {
    btnLocate.classList.add('hidden');
  }
}

function panToActivePhoto() {
  const filtered = getFilteredPhotos();
  const p = filtered[activePhotoIndex];
  if (p) {
    closeLightbox();
    focusPhoto(p.id);
  }
}

function detectLandmarkForActive() {
  const filtered = getFilteredPhotos();
  const p = filtered[activePhotoIndex];
  if (p) {
    detectLandmark(p.id);
  }
}

function startManualPlacementForActive() {
  const filtered = getFilteredPhotos();
  const p = filtered[activePhotoIndex];
  if (p) {
    startManualPlacement(p.id);
  }
}

// Delete and Clear
async function deletePhoto(photoId) {
  if (!confirm('Are you sure you want to remove this photo?')) return;
  try {
    const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
    if (res.ok) {
      photos = photos.filter(p => p.id !== photoId);
      renderAll();
    }
  } catch (err) {
    alert('Failed to delete photo: ' + err.message);
  }
}

async function clearAllPhotos() {
  if (photos.length === 0) return;
  if (!confirm('Are you sure you want to clear all photos?')) return;

  try {
    const res = await fetch('/api/clear', { method: 'POST' });
    if (res.ok) {
      photos = [];
      renderAll();
    }
  } catch (err) {
    alert('Failed to clear photos: ' + err.message);
  }
}

// GeoJSON Export
function exportGeoJSON() {
  window.open('/api/export/geojson', '_blank');
}

// Settings Modal
function openSettingsModal() {
  document.getElementById('input-gemini-key').value = geminiApiKey;
  document.getElementById('toggle-autodetect').checked = autoDetectLandmarks;
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function saveSettings() {
  geminiApiKey = document.getElementById('input-gemini-key').value.trim();
  autoDetectLandmarks = document.getElementById('toggle-autodetect').checked;

  localStorage.setItem('photo_map_gemini_key', geminiApiKey);
  localStorage.setItem('photo_map_autodetect', autoDetectLandmarks ? 'true' : 'false');

  closeSettingsModal();
}

function loadSavedSettings() {
  geminiApiKey = localStorage.getItem('photo_map_gemini_key') || '';
  autoDetectLandmarks = localStorage.getItem('photo_map_autodetect') === 'true';
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
  } else {
    input.type = 'password';
  }
}

// Photo Tray Collapse
function togglePhotoTray() {
  const tray = document.getElementById('photo-tray');
  const btn = document.getElementById('btn-toggle-tray');

  if (tray.classList.contains('h-64')) {
    tray.classList.remove('h-64');
    tray.classList.add('h-10');
    btn.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
  } else {
    tray.classList.remove('h-10');
    tray.classList.add('h-64');
    btn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
  }
}

// ==========================================
// SCREENSHOT FEATURE
// ==========================================
let originalScreenshotCanvas = null;
let currentScreenshotCanvas = null;

async function captureMapScreenshot() {
  showProgressToast(true, 'Capturing Map Snapshot', 50, 'Rendering map tiles and photo pins...');

  try {
    const mapElement = document.getElementById('map');

    // Use html2canvas with crossOrigin
    const canvas = await html2canvas(mapElement, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: 2 // 2x for sharp HD snapshot!
    });

    originalScreenshotCanvas = canvas;
    currentScreenshotCanvas = canvas;

    document.getElementById('screenshot-preview-img').src = canvas.toDataURL('image/png');
    document.getElementById('screenshot-title-input').value = '';
    document.getElementById('screenshot-modal').classList.remove('hidden');
    showProgressToast(false);
  } catch (err) {
    showProgressToast(false);
    console.error('Screenshot capture error:', err);
    alert('Failed to capture map screenshot: ' + err.message);
  }
}

function applyScreenshotTitle() {
  if (!originalScreenshotCanvas) return;

  const titleText = document.getElementById('screenshot-title-input').value.trim();
  if (!titleText) {
    currentScreenshotCanvas = originalScreenshotCanvas;
    document.getElementById('screenshot-preview-img').src = originalScreenshotCanvas.toDataURL('image/png');
    return;
  }

  // Create new canvas with title header banner
  const w = originalScreenshotCanvas.width;
  const h = originalScreenshotCanvas.height;
  const bannerHeight = 140;

  const newCanvas = document.createElement('canvas');
  newCanvas.width = w;
  newCanvas.height = h + bannerHeight;

  const ctx = newCanvas.getContext('2d');

  // Background banner
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, bannerHeight);

  // Title text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(titleText, 40, 75);

  // Subtitle / stats
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  ctx.fillStyle = '#10b981';
  ctx.font = '24px sans-serif';
  ctx.fillText(`PhotoMap Explorer • ${dateStr}`, 40, 115);

  // Draw map image below banner
  ctx.drawImage(originalScreenshotCanvas, 0, bannerHeight);

  currentScreenshotCanvas = newCanvas;
  document.getElementById('screenshot-preview-img').src = newCanvas.toDataURL('image/png');
}

function downloadScreenshot(format = 'png') {
  if (!currentScreenshotCanvas) return;
  const a = document.createElement('a');
  a.download = `PhotoMap_Snapshot_${Date.now()}.${format}`;
  a.href = currentScreenshotCanvas.toDataURL(`image/${format}`);
  a.click();
}

async function copyScreenshotToClipboard() {
  if (!currentScreenshotCanvas) return;
  try {
    currentScreenshotCanvas.toBlob(async (blob) => {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      alert('Snapshot copied to clipboard!');
    });
  } catch (err) {
    alert('Copy to clipboard not supported by browser: ' + err.message);
  }
}

function closeScreenshotModal() {
  document.getElementById('screenshot-modal').classList.add('hidden');
}

// ==========================================
// 4K VIDEO TOUR STUDIO
// ==========================================
let currentAppTab = 'map';
let tourWaypoints = [];
let isTourPreviewing = false;
let tourPreviewTimeout = null;

function switchAppTab(tab) {
  currentAppTab = tab;
  const btnMap = document.getElementById('tab-btn-map');
  const btnVideo = document.getElementById('tab-btn-video');
  const videoSidebar = document.getElementById('video-sidebar');
  const photoTray = document.getElementById('photo-tray');

  if (tab === 'video') {
    btnVideo.className = "px-3 py-1.5 rounded-lg text-xs font-bold transition bg-amber-600 text-white shadow flex items-center gap-1.5";
    btnMap.className = "px-3 py-1.5 rounded-lg text-xs font-bold transition text-slate-300 hover:bg-slate-700 flex items-center gap-1.5";

    videoSidebar.classList.remove('hidden');
    photoTray.classList.add('hidden');

    if (tourWaypoints.length === 0) {
      autoGenerateTourFromPhotos();
    } else {
      renderStoryboard();
    }
  } else {
    btnMap.className = "px-3 py-1.5 rounded-lg text-xs font-bold transition bg-emerald-600 text-white shadow flex items-center gap-1.5";
    btnVideo.className = "px-3 py-1.5 rounded-lg text-xs font-bold transition text-slate-300 hover:bg-slate-700 flex items-center gap-1.5";

    videoSidebar.classList.add('hidden');
    photoTray.classList.remove('hidden');
    stopTourPreview();
  }

  setTimeout(() => map.invalidateSize(), 150);
}

function autoGenerateTourFromPhotos() {
  const located = photos.filter(p => p.latitude !== null && p.longitude !== null);
  if (located.length === 0) {
    alert('No photos currently have location coordinates. Upload photos or locate them first!');
    return;
  }

  tourWaypoints = located.map((p, idx) => ({
    id: p.id,
    photo_id: p.id,
    lat: p.latitude,
    lon: p.longitude,
    zoom: 14,
    duration: 3.0,
    label: p.landmark_name || p.filename,
    source: p.location_source,
    thumb_url: p.thumb_url
  }));

  renderStoryboard();
}

function addCurrentViewToTour() {
  const center = map.getCenter();
  const zoom = map.getZoom();

  tourWaypoints.push({
    id: 'custom_' + Date.now(),
    photo_id: null,
    lat: center.lat,
    lon: center.lng,
    zoom: zoom,
    duration: 3.0,
    label: `Custom View (${center.lat.toFixed(2)}, ${center.lng.toFixed(2)})`,
    source: 'custom',
    thumb_url: null
  });

  renderStoryboard();
}

function renderStoryboard() {
  const container = document.getElementById('video-storyboard-list');
  if (!container) return;

  if (tourWaypoints.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-slate-500 text-xs">
        <i class="fa-solid fa-film text-2xl text-slate-600 mb-2"></i>
        <p>No scenes added yet.</p>
        <p class="text-[11px] text-slate-600 mt-1">Click <strong>Auto Tour</strong> or <strong>Add View</strong></p>
      </div>
    `;
    return;
  }

  container.innerHTML = tourWaypoints.map((wp, idx) => {
    const isCustom = !wp.photo_id;
    const thumbHtml = wp.thumb_url
      ? `<img src="${wp.thumb_url}" class="w-12 h-12 rounded-lg object-cover border border-slate-700 bg-slate-950 flex-shrink-0">`
      : `<div class="w-12 h-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 text-sm flex-shrink-0"><i class="fa-solid fa-map-location-dot"></i></div>`;

    return `
      <div class="p-2 rounded-xl bg-slate-800/80 border border-slate-700/80 flex items-center gap-2.5 transition hover:border-amber-500/50">
        <span class="w-5 h-5 rounded-full bg-slate-700 text-slate-300 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
          ${idx + 1}
        </span>
        ${thumbHtml}
        <div class="flex-1 overflow-hidden">
          <div class="text-xs font-semibold text-white truncate" title="${wp.label}">${wp.label}</div>
          <div class="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
            <span>Hold: <strong>${wp.duration}s</strong></span>
            <span>&bull;</span>
            <span>Zoom: ${wp.zoom}</span>
          </div>
        </div>
        <div class="flex flex-col gap-1 flex-shrink-0">
          <button onclick="panMapToWaypoint(${idx})" class="p-1 text-slate-400 hover:text-white text-[11px]" title="Fly to on map">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button onclick="removeTourWaypoint(${idx})" class="p-1 text-slate-500 hover:text-red-400 text-[11px]" title="Remove scene">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function panMapToWaypoint(idx) {
  const wp = tourWaypoints[idx];
  if (wp) {
    map.flyTo([wp.lat, wp.lon], wp.zoom, { duration: 1.5 });
  }
}

function removeTourWaypoint(idx) {
  tourWaypoints.splice(idx, 1);
  renderStoryboard();
}

function clearTourWaypoints() {
  if (tourWaypoints.length === 0) return;
  if (!confirm('Clear all scenes from the video tour?')) return;
  tourWaypoints = [];
  renderStoryboard();
}

// Live Tour Preview in Map
async function toggleTourPreview() {
  if (isTourPreviewing) {
    stopTourPreview();
  } else {
    startTourPreview();
  }
}

async function startTourPreview() {
  if (tourWaypoints.length === 0) {
    alert('Please add at least one scene to preview the tour!');
    return;
  }

  isTourPreviewing = true;
  document.getElementById('preview-tour-banner').classList.remove('hidden');
  document.getElementById('btn-preview-tour').innerHTML = '<i class="fa-solid fa-stop text-red-400"></i> Stop Preview';

  for (let i = 0; i < tourWaypoints.length; i++) {
    if (!isTourPreviewing) break;

    const wp = tourWaypoints[i];
    document.getElementById('preview-tour-step').textContent = `Scene ${i + 1} of ${tourWaypoints.length} (${wp.label})`;

    map.flyTo([wp.lat, wp.lon], wp.zoom, {
      duration: 2.0,
      easeLinearity: 0.25
    });

    await new Promise(r => {
      tourPreviewTimeout = setTimeout(r, (2.0 + wp.duration) * 1000);
    });
  }

  stopTourPreview();
}

function stopTourPreview() {
  isTourPreviewing = false;
  if (tourPreviewTimeout) clearTimeout(tourPreviewTimeout);
  const banner = document.getElementById('preview-tour-banner');
  if (banner) banner.classList.add('hidden');
  const btn = document.getElementById('btn-preview-tour');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-play text-amber-400"></i> Preview Flight';
}

// 4K Video Rendering Call
let videoStatusPollInterval = null;

async function startRenderVideo() {
  if (tourWaypoints.length === 0) {
    alert('Please add at least one scene to render a video!');
    return;
  }

  const title = document.getElementById('video-title-input').value.trim() || 'My Photo Map Tour';
  const resolution = document.getElementById('video-resolution-select').value;
  const fps = parseInt(document.getElementById('video-fps-select').value, 10);
  const mapStyle = localStorage.getItem('photo_map_layer') || 'satellite';

  // Open modal in rendering state
  document.getElementById('video-render-modal').classList.remove('hidden');
  document.getElementById('video-rendering-box').classList.remove('hidden');
  document.getElementById('video-completed-box').classList.add('hidden');

  document.getElementById('video-progress-title').textContent = `Rendering ${resolution.toUpperCase()} Video Frames...`;
  document.getElementById('video-progress-details').textContent = `Resolution: ${resolution === '4k' ? '3840 x 2160 UHD' : '1920 x 1080 HD'} • ${fps} FPS`;
  document.getElementById('video-progress-bar').style.width = '0%';
  document.getElementById('video-progress-percentage').textContent = '0%';

  try {
    const res = await fetch('/api/render-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        waypoints: tourWaypoints,
        title: title,
        resolution: resolution,
        fps: fps,
        map_style: mapStyle
      })
    });

    const data = await res.json();
    if (!data.success || !data.job_id) {
      alert('Failed to start video rendering: ' + (data.error || 'Unknown error'));
      closeVideoRenderModal();
      return;
    }

    pollVideoJob(data.job_id);
  } catch (err) {
    alert('Render request failed: ' + err.message);
    closeVideoRenderModal();
  }
}

function pollVideoJob(jobId) {
  if (videoStatusPollInterval) clearInterval(videoStatusPollInterval);

  videoStatusPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/video-status/${jobId}`);
      const job = await res.json();

      if (job.status === 'rendering') {
        const pct = job.progress || 0;
        document.getElementById('video-progress-bar').style.width = `${pct}%`;
        document.getElementById('video-progress-percentage').textContent = `${pct}%`;
        if (job.total_frames) {
          document.getElementById('video-progress-details').textContent = `Frame ${job.current_frame || 0} / ${job.total_frames} (FFmpeg 4K Stream)...`;
        }
      } else if (job.status === 'completed') {
        clearInterval(videoStatusPollInterval);

        // Show player
        document.getElementById('video-rendering-box').classList.add('hidden');
        document.getElementById('video-completed-box').classList.remove('hidden');

        const player = document.getElementById('video-player-element');
        const source = document.getElementById('video-player-source');
        source.src = job.video_url;
        player.load();

        const downloadBtn = document.getElementById('video-download-btn');
        downloadBtn.href = job.video_url;
        downloadBtn.download = job.filename || 'PhotoMap_Tour_4K.mp4';
      } else if (job.status === 'error') {
        clearInterval(videoStatusPollInterval);
        alert('Video rendering failed: ' + (job.error || 'Unknown error'));
        closeVideoRenderModal();
      }
    } catch (e) {
      console.error('Polling error:', e);
    }
  }, 1000);
}

function closeVideoRenderModal() {
  if (videoStatusPollInterval) clearInterval(videoStatusPollInterval);
  const player = document.getElementById('video-player-element');
  if (player) player.pause();
  document.getElementById('video-render-modal').classList.add('hidden');
}
