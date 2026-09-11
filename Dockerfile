FROM python:3.12-slim

# Install system dependencies (ffmpeg, libraw, opencv dependencies)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Ensure upload and cache directories exist
RUN mkdir -p static/uploads/tile_cache static/uploads/videos

ENV PORT=5000
EXPOSE 5000

CMD ["sh", "-c", "gunicorn -w 2 -b 0.0.0.0:${PORT:-5000} app:app --timeout 180"]
