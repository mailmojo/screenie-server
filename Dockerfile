FROM node:20-bookworm-slim AS base

ARG PUPPETEER_SKIP_DOWNLOAD=true
ENV SCREENIE_VERSION=6.0.0 \
  SCREENIE_CHROMIUM_ARGS="--no-sandbox" \
  PUPPETEER_SKIP_DOWNLOAD=${PUPPETEER_SKIP_DOWNLOAD} \
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=${PUPPETEER_SKIP_DOWNLOAD} \
  NODE_ENV=production \
  SCREENIE_CHROMIUM_EXEC=/usr/bin/chromium

# Install Chromium, fonts, and a minimal init.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-freefont-ttf \
    ca-certificates \
    dumb-init \
  --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

RUN chown -R node:node /usr/src/app
USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/server.js"]
