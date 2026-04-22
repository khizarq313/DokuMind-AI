# ═══════════════════════════════════════════
#  DocuMind Frontend — Multi-stage Dockerfile
# ═══════════════════════════════════════════

# ── Stage 1: Builder ──
FROM node:20-alpine as builder

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Build for production
RUN npm run build

# ── Stage 2: Production (nginx) ──
FROM nginx:alpine as production

# Copy built assets
COPY --from=builder /build/dist /usr/share/nginx/html

# Custom nginx config for SPA routing
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location /api/ { \
        proxy_pass http://backend:8080; \
        proxy_http_version 1.1; \
        proxy_set_header Upgrade $http_upgrade; \
        proxy_set_header Connection "upgrade"; \
        proxy_set_header Host $host; \
        proxy_buffering off; \
        proxy_cache off; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://localhost/ || exit 1
