# Build stage for uv binary
FROM ghcr.io/astral-sh/uv:latest AS uv_bin

# Build stage for frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Final stage for backend and serving frontend
FROM python:3.13-slim
WORKDIR /app

# Copy uv binary
COPY --from=uv_bin /uv /uv/bin/uv
ENV PATH="/uv/bin:$PATH"

# Install system dependencies if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install with uv
COPY backend/pyproject.toml ./backend/
RUN uv pip install --no-cache-dir --system ./backend/

# Copy backend source
COPY backend/src ./src

# Copy built frontend assets from the builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend_dist

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# Expose the combined port
EXPOSE 8000

# Start the application
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
