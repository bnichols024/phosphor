FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PHOSPHOR_ROOT=/phosphor \
    PORT=8080 \
    PHOSPHOR_HTTPS_PORT=8443

# openssl makes the self-signed certificate for the optional HTTPS port.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY tools ./tools
COPY db ./db
COPY bios ./bios
COPY web ./web

# Bake every emulator into the image so it works offline out of the box. The in-app Update
# button installs newer versions into the library volume without rebuilding the image.
RUN node tools/fetch-emulators.mjs /app/vendor/emulators

VOLUME /phosphor
EXPOSE 8080 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/library/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
