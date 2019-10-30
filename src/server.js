#!/usr/bin/env node

const Koa = require('koa');
const winston = require('winston');
const createPuppeteerPool = require('puppeteer-pool').default;
const { combine, timestamp, printf } = winston.format;

const loggerFormat = printf(({ message, timestamp }) => {
  return `[${timestamp}] ${message}`;
});

const logger = winston.createLogger({
  level: process.env.SCREENIE_LOG_LEVEL || 'info',
  format: combine(timestamp(), loggerFormat),
  transports: [
    new winston.transports.Console({
      timestamp: () => new Date().toISOString(),
    }),
  ],
});

logger.log('verbose', 'Setting up defaults from environment');
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
logger.log('verbose', 'Created KOA server');

const pool = createPuppeteerPool({
  min: process.env.SCREENIE_POOL_MIN || 2,
  max: process.env.SCREENIE_POOL_MAX || 10,
  puppeteerArgs: Object.assign({}, chromiumArgs, chromiumExec),
});

const screenshotDelay = () =>
  new Promise(resolve =>
    setTimeout(resolve, process.env.SCREENIE_SCREENSHOT_DELAY || 50)
  );

logger.log('verbose', 'Created Puppeteer pool');

/*
 * Clean up the Puppeteer pool before exiting when receiving a termination
 * signal. Exit with status code 143 (128 + SIGTERM's signal number, 15).
 */
process.on('SIGTERM', () => {
  logger.log('info', 'Received SIGTERM, exiting...');
  pool
    .drain()
    .then(() => pool.clear())
    .then(() => process.exit(143));
});

/**
 * Set up a Puppeteer instance for a page and configure viewport size.
 */
app.use(async (ctx, next) => {
  const { width, height } = ctx.request.query;
  const size = {
    width: Math.min(2048, parseInt(width, 10) || imageSize.width),
    height: Math.min(2048, parseInt(height, 10) || imageSize.height),
  };
  let pageError;

  logger.log(
    'verbose',
    `Instantiating Page with size ${size.width}x${size.height}`
  );

  await pool.use(instance => {
    const pid = instance.process().pid;
    logger.log('verbose', `Using browser instance with PID ${pid}`);
    return instance
      .newPage()
      .then(page => {
        logger.log('verbose', 'Set page instance on state');
        ctx.state.page = page;
      })
      .then(() => {
        logger.log('verbose', 'Set viewport for page');
        return ctx.state.page.setViewport(size);
      })
      .catch(error => {
        pageError = error;
        logger.log('verbose', `Invalidating instance with PID ${pid}`);
        pool.invalidate(instance);
      });
  });

  if (pageError) {
    ctx.throw(400, `Could not open a page: ${pageError.message}`);
  }

  await next();
});

/**
 * Attempt to load given URL in the Puppeteer page.
 *
 * Throws 400 Bad Request if no URL is provided, and 404 Not Found if
 * Puppeteer could not load the URL.
 */
app.use(async (ctx, next) => {
  const { page } = ctx.state;
  const { url } = ctx.request.query;

  let gotoError;

  if (!url) {
    ctx.throw(400, 'No url request parameter supplied.');
  }

  if (url.indexOf('file://') >= 0 && !allowFileScheme) {
    ctx.throw(403);
  }

  logger.log('verbose', `Attempting to load ${url}`);

  await page
    .goto(url)
    .then(screenshotDelay)
    .catch(() => (gotoError = true));

  if (gotoError) {
    ctx.throw(404);
  }

  await next();
});

/**
 * Determine the format of the output based on the `format` query parameter.
 *
 * The format must be among the formats supported by Puppeteer, else 400
 * Bad Request is thrown. If no format is provided, the default is used.
 */
app.use(async (ctx, next) => {
  const { format = defaultFormat } = ctx.request.query;

  if (supportedFormats.indexOf(format.toLowerCase()) === -1) {
    ctx.throw(400, `Format ${format} not supported.`);
  }

  ctx.type = ctx.state.format = format;

  await next();
});

/**
 * Generate a screenshot of the loaded page.
 *
 * If successful the screenshot is sent as the response.
 */
app.use(async (ctx, next) => {
  const { url, fullPage } = ctx.request.query;
  const { format, page } = ctx.state;
  const { width, height } = page.viewport();
  let renderError;

  logger.log('info', `Rendering screenshot of ${url} to ${format}`);

  if (format === 'pdf') {
    await page
      .pdf({
        format: 'A4',
        margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
      })
      .then(response => (ctx.body = response))
      .catch(error => (renderError = error));
  } else {
    let clipInfo =
      fullPage === '1'
        ? { fullPage: true }
        : { clip: { x: 0, y: 0, width: width, height: height } };
    await page
      .screenshot(
        Object.assign(
          {
            type: format === 'jpg' ? 'jpeg' : format,
            omitBackground: true,
          },
          clipInfo
        )
      )
      .then(response => (ctx.body = response))
      .catch(error => (renderError = error));
  }

  if (renderError) {
    ctx.throw(400, `Could not render page: ${renderError.message}`);
  }

  await page.close();

  await next();
});

/**
 * Error handler to make sure page is getting closed.
 */
app.on('error', (error, context) => {
  const { page } = context.state;

  if (page) {
    page.close();
  }

  logger.log('error', error.message);
});

app.listen(serverPort);
logger.log('info', `Screenie server started on port ${serverPort}`);
