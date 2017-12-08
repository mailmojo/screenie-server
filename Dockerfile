FROM node:9.2.0-alpine

ENV SCREENIE_VERSION=1.2.0

RUN apk add --no-cache fontconfig curl ca-certificates \
    && curl -Ls "https://github.com/dustinblackman/phantomized/releases/download/2.1.1/dockerized-phantomjs.tar.gz" | tar xz -C / \
    && npm install -g screenie-server@$SCREENIE_VERSION --unsafe-perm \
    && apk del curl \
    && rm -rf /tmp/*

EXPOSE 3000

CMD update-ca-certificates && /usr/local/bin/screenie
