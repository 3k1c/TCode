# Build context = repository root:  docker build -f packages/headless/docker/Dockerfile -t tcode-headless .
# ---------- build ----------
FROM node:22-bookworm AS build
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
# The Electron binary is never needed (we only bundle the renderer and the Node server).
ENV VITE_TCODE_HEADLESS=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm_config_registry=${NPM_REGISTRY}
RUN npm ci --registry=${NPM_REGISTRY} --replace-registry-host=always
RUN npm run build -w packages/desktop && npm run build -w packages/headless
# Runtime-only dependencies, compiled for this image (node-pty is native).
WORKDIR /src/packages/headless/dist
RUN cp ../docker/runtime-package.json package.json \
 && npm install --omit=dev --no-audit --no-fund --registry=${NPM_REGISTRY} \
 && node -e "import('node-pty').then(()=>console.log('node-pty ok'))"

# ---------- runtime ----------
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git bash ca-certificates tini openssh-client ripgrep fd-find curl \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOME=/data/home \
    TCODE_DATA_DIR=/data/tcode \
    TCODE_PORT=1200 \
    TCODE_SCOPE=lan \
    TCODE_SHELL=/bin/bash
COPY --from=build /src/packages/headless/dist /app
WORKDIR /workspace
EXPOSE 1200
# Run as an unprivileged user (override with `user:` in compose to match the NAS volume owner).
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/server.mjs"]
