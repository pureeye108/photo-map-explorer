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

# Ensure upload and cache directories exist with full write permissions (for Hugging Face Spaces UID 1000)
RUN mkdir -p static/uploads/tile_cache static/uploads/videos && \
    chmod -R 777 static/uploads

ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "gunicorn -w 2 -b 0.0.0.0:${PORT:-7860} app:app --timeout 180"]

