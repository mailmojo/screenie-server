FROM node:20-bookworm-slim AS base

ARG PUPPETEER_SKIP_DOWNLOAD=true
ENV SCREENIE_VERSION=6.0.0 \
  SCREENIE_CHROMIUM_ARGS=--no-sandbox \
  PUPPETEER_SKIP_DOWNLOAD=${PUPPETEER_SKIP_DOWNLOAD} \
  NODE_ENV=production

# Install Chromium & fonts & dumb-init
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-common \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-freefont-ttf \
    wget \
    ca-certificates \
    git \
    dumb-init \
  --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Path for system chromium (adjust if needed)
ENV SCREENIE_CHROMIUM_EXEC=/usr/bin/chromium

WORKDIR /usr/src/app

# Copy dependency manifests first for better caching
COPY package.json package-lock.json ./

# Install dependencies (production only). Use npm ci for deterministic clean install.
RUN npm ci --only=production && npm cache clean --force

COPY src ./src

# Create non-root user
RUN useradd -m -d /home/nodeuser nodeuser && chown -R nodeuser:nodeuser /usr/src/app
USER nodeuser

EXPOSE 3000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/server.js"]
