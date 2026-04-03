# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ── Stage 2: Python app ─────────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# Install Python dependencies
COPY pyproject.toml .
COPY bigraph_loom/ bigraph_loom/
RUN pip install --no-cache-dir .

# Copy built frontend
COPY --from=frontend /app/frontend/dist frontend/dist

EXPOSE 8891

CMD ["uvicorn", "bigraph_loom.api:app", "--host", "0.0.0.0", "--port", "8891"]
