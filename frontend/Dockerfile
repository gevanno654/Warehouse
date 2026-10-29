# Build from the repository root:
#   docker build -f frontend/Dockerfile --build-arg VITE_API_BASE_URL=http://localhost:3000 .

# ---- Build stage ----
FROM node:24-alpine AS build
WORKDIR /app

# Vite inlines VITE_API_BASE_URL at build time, so it is a build argument, not
# a runtime environment variable. Changing it requires rebuilding this image.
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/tsconfig.json frontend/vite.config.ts frontend/vitest.setup.ts frontend/index.html ./
COPY frontend/src ./src

RUN npm run build

# ---- Runtime stage ----
FROM nginx:1.29-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
