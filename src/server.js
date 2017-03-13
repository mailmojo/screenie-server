#!/usr/bin/env node

const fs = require('fs');
const koa = require('koa');
const tmp = require('tmp');
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
const supportedFormats = [
    'gif',
    'jpeg',
    'jpg',
    'pdf',
    'png',
]
const defaultFormat = process.env.SCREENIE_DEFAULT_FORMAT || 'jpeg';

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
        this.throw('No url request parameter supplied.', 400);
    }

    yield this.state.page.open(url)
        .then(status => status === 'success')
        .then(loaded => loaded || this.throw(404));

    yield next;
});

/**
 * Determine the format of the output based on the `format` query parameter.
 *
 * The format must be among the formats supported by PhantomJS, else 400
 * Bad Request is thrown. If no format is provided, the default is used.
 */
app.use(function *(next) {
    const { format = defaultFormat } = this.request.query;

    if (supportedFormats.indexOf(format.toLowerCase()) === -1) {
        this.throw(`Format ${format} not supported.`, 400);
    }

    this.type = this.state.format = format;
    yield next;
});

/**
 * Set up the size of the page to render, either the paper size for PDF or
 * clip rectangle for image formats.
 */
app.use(function *(next) {
    if (this.state.format === 'pdf') {
        yield this.state.page.property('paperSize', {
            format: 'A4',
            orientation: 'portrait',
            border: '1cm',
        });
    }
    else {
        yield this.state.page.property('viewportSize')
            .then(size => ({
                top: 0,
                left: 0,
                width: size.width,
                height: size.height,
            }))
            .then(clipRect => this.state.page.property('clipRect', clipRect));
    }

    yield next;
});

/**
 * Generate a screenshot of the loaded page.
 *
 * If successful the screenshot is sent as the response.
 */
app.use(function *(next) {
    if (this.state.format === 'pdf') {
        const tmpFile = tmp.fileSync({ postfix: '.pdf'});

        yield this.state.page.render(tmpFile.name)
            .then(() => {
                this.body = fs.createReadStream(tmpFile.name);

                // Delete the temp file after served to client
                this.body.on('close', () => tmpFile.removeCallback());
            });
    }
    else {
        yield this.state.page.renderBase64(this.state.format)
            .then((imageData) => this.body = Buffer.from(imageData, 'base64'));
    }
});

app.listen(serverPort);
console.log(`Screenie server started on port ${serverPort}`);
