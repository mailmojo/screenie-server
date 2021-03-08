FROM node:14-alpine3.12

ARG TARGETPLATFORM

ENV SCREENIE_VERSION=4.0.0
ENV SCREENIE_CHROMIUM_ARGS=--no-sandbox
ENV SCREENIE_CHROMIUM_EXEC=/usr/lib/chromium/chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Installs latest Chromium package
RUN apk update && apk upgrade && \
  apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ttf-freefont \
  font-noto-cjk \
  git

RUN if [ "$TARGETPLATFORM" = "linux/amd64" ]; then \
  wget -O /usr/local/bin/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_x86_64; else \
  wget -O /usr/local/bin/dumb-init https://github.com/Yelp/dumb-init/releases/download/v1.2.5/dumb-init_1.2.5_aarch64; fi \
  && chmod +x /usr/local/bin/dumb-init

ENTRYPOINT ["dumb-init"]

RUN npm install -g screenie-server@${SCREENIE_VERSION} --unsafe-perm

EXPOSE 3000

CMD /usr/local/bin/screenie
