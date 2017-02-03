#!/usr/bin/env node

const fs = require('fs');
const koa = require('koa');
const createPhantomPool = require('phantom-pool').default;

const app = koa();
const pool = createPhantomPool({
    min: process.env.SCREENIE_POOL_MIN || 2,
    max: process.env.SCREENIE_POOL_MAX || 10,
});
const serverPort = process.env.SCREENIE_PORT || 3000;

const imageSize = {
    width: process.env.SCREENIE_WIDTH || 1024,
    height: process.env.SCREENIE_HEIGHT || 768,
};
const imageType = process.env.SCREENIE_IMAGE_TYPE || 'jpeg';

/**
 * Set up a PhantomJS instance with a page and configure viewport size.
 */
app.use(function *(next) {
    const size = {
        width: Math.min(
            2048,
            parseInt(this.request.query.width, 10) || imageSize.width
        ),
        height: Math.min(
            2048,
            parseInt(this.request.query.height, 10) || imageSize.height
        ),
    };

    yield pool.use(instance => instance.createPage())
        .then(page => this.state.page = page)
        .then(() => this.state.page.property('viewportSize', size));

    yield next;
});

/**
 * Attempt to load given URL in the PhantomJS page.
 *
 * Throws 400 Bad Request if no URL is provided, and 404 Not Found if
 * PhantomJS could not load the URL.
 */
app.use(function *(next) {
    const { url } = this.request.query;

    if (!url) {
        this.throw(400);
    }

    yield this.state.page.open(url)
        .then(status => status === 'success')
        .then(loaded => loaded || this.throw(404));

    yield next;
});

/**
 * Generate a screenshot of the loaded page.
 *
 * If successful the screenshot is sent as the response.
 */
app.use(function *(next) {
    yield this.state.page.property('viewportSize')
        .then(size => ({
            top: 0, left: 0,
            width: size.width, height: size.height
        }))
        .then(clipRect => this.state.page.property('clipRect', clipRect))
        .then(() => this.state.page.renderBase64(imageType))
        .then((imageData) => {
            this.type = `image/${imageType}`;
            this.body = Buffer.from(imageData, 'base64');
        });
});

app.listen(serverPort);
console.log(`Screenie server started on port ${serverPort}`);
