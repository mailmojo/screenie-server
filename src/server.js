#!/usr/bin/env node

const fs = require('fs');
const Koa = require('koa');
const puppeteer = require('puppeteer');
const tmp = require('tmp');
const winston = require('winston');

const logger = new winston.Logger({
  level: process.env.SCREENIE_LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({
      timestamp: () => new Date().toISOString(),
    }),
  ],
});

logger.verbose('Setting up defaults from environment');
const chromiumArgs = process.env.SCREENIE_CHROMIUM_ARGS
  ? { args: process.env.SCREENIE_CHROMIUM_ARGS.split(' ') }
  : {};
const chromiumExec = process.env.SCREENIE_CHROMIUM_EXEC
  ? { executablePath: process.env.SCREENIE_CHROMIUM_EXEC }
  : {};
const defaultFormat = process.env.SCREENIE_DEFAULT_FORMAT || 'jpeg';
const imageSize = {
  width: process.env.SCREENIE_WIDTH || 1024,
  height: process.env.SCREENIE_HEIGHT || 768,
};
const serverPort = process.env.SCREENIE_PORT || 3000;
const supportedFormats = ['jpg', 'jpeg', 'pdf', 'png'];
const allowFileScheme = process.env.SCREENIE_ALLOW_FILE_SCHEME || false;

const app = new Koa();
logger.verbose('Created KOA server');

const puppeteerArgs = Object.assign({}, chromiumArgs, chromiumExec);

const screenshotDelay = () =>
  new Promise(resolve =>
    setTimeout(resolve, process.env.SCREENIE_SCREENSHOT_DELAY | 50)
  );

puppeteer.launch({ ...puppeteerArgs }).then(instance => {
  /**
   * Set up a Puppeteer instance for a page and configure viewport size.
   */
  app.use(function*(next) {
    const { width, height } = this.request.query;
    const size = {
      width: Math.min(2048, parseInt(width, 10) || imageSize.width),
      height: Math.min(2048, parseInt(height, 10) || imageSize.height),
    };
    let pageError;

    logger.verbose(`Instantiating Page with size ${size.width}x${size.height}`);

    yield instance
      .newPage()
      .then(page => {
        logger.verbose('Set page instance on state');
        this.state.page = page;
      })
      .then(() => {
        logger.verbose('Set viewport for page');
        return this.state.page.setViewport(size);
      })
      .catch(error => {
        pageError = error;
      });

    if (pageError) {
      this.throw(400, `Could not open a page: ${pageError.message}`);
    }

    yield next;
  });

  /**
   * Attempt to load given URL in the Puppeteer page.
   *
   * Throws 400 Bad Request if no URL is provided, and 404 Not Found if
   * Puppeteer could not load the URL.
   */
  app.use(function*(next) {
    const { page } = this.state;
    const { url } = this.request.query;

    let gotoError;

    if (!url) {
      this.throw(400, 'No url request parameter supplied.');
    }

    if (url.indexOf('file://') >= 0 && !allowFileScheme) {
      this.throw(403);
    }

    logger.verbose(`Attempting to load ${url}`);

    yield page
      .goto(url)
      .then(screenshotDelay)
      .catch(() => (gotoError = true));

    if (gotoError) {
      this.throw(404);
    }

    yield next;
  });

  /**
   * Determine the format of the output based on the `format` query parameter.
   *
   * The format must be among the formats supported by Puppeteer, else 400
   * Bad Request is thrown. If no format is provided, the default is used.
   */
  app.use(function*(next) {
    const { format = defaultFormat } = this.request.query;

    if (supportedFormats.indexOf(format.toLowerCase()) === -1) {
      this.throw(400, `Format ${format} not supported.`);
    }

    this.type = this.state.format = format;

    yield next;
  });

  /**
   * Generate a screenshot of the loaded page.
   *
   * If successful the screenshot is sent as the response.
   */
  app.use(function*(next) {
    const { url, fullPage } = this.request.query;
    const { format, page, browser } = this.state;
    const { width, height } = page.viewport();
    let renderError;

    logger.info(`Rendering screenshot of ${url} to ${format}`);

    if (format === 'pdf') {
      yield page
        .pdf({
          format: 'A4',
          margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
        })
        .then(response => (this.body = response))
        .catch(error => (renderError = error));
    } else {
      let clipInfo =
        fullPage === '1'
          ? { fullPage: true }
          : { clip: { x: 0, y: 0, width: width, height: height } };
      yield page
        .screenshot(
          Object.assign(
            {
              type: format === 'jpg' ? 'jpeg' : format,
              omitBackground: true,
            },
            clipInfo
          )
        )
        .then(response => (this.body = response))
        .catch(error => (renderError = error));
    }

    if (renderError) {
      this.throw(400, `Could not render page: ${renderError.message}`);
    }

    yield page.close();

    yield next;
  });

  /**
   * Error handler to make sure page is getting closed.
   */
  app.on('error', (error, context) => {
    const { page } = context.state;

    if (page) {
      page.close();
    }

    logger.error(error.message);
  });

  app.listen(serverPort);
  logger.info(`Screenie server started on port ${serverPort}`);
});
