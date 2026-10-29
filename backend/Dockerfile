# Build from the repository root so the approved OpenAPI document can be
# copied into the image:
#   docker build -f backend/Dockerfile -t warehouse-api .

# ---- Build stage ----
FROM node:24-alpine AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/tsconfig.json backend/tsconfig.build.json backend/prisma.config.ts ./
COPY backend/prisma ./prisma
COPY backend/src ./src

RUN npx prisma generate
RUN npm run build

# ---- Runtime stage ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist

# Served by the API at `/openapi.yaml` and rendered by Swagger UI at `/docs`.
# The file is copied unchanged; `docs/openapi.yaml` remains the single source.
COPY docs/openapi.yaml ./docs/openapi.yaml

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
