#!/usr/bin/env node

const Koa = require('koa');
const winston = require('winston');
const { Cluster } = require('puppeteer-cluster');
const { combine, timestamp, printf, errors, splat, colorize, json } = winston.format;

const logFormat = printf(info => {
  const ts = info.timestamp;
  const level = info.level;
  const msg = info.message;
  const stack = info.stack ? `\n${info.stack}` : '';
  return `[${ts}] ${level}: ${msg}${stack}`;
});

const isJson = process.env.SCREENIE_LOG_FORMAT === 'json';
const isDev = process.env.NODE_ENV !== 'production';

const logger = winston.createLogger({
  level: process.env.SCREENIE_LOG_LEVEL || 'info',
  defaultMeta: { service: 'screenie-server' },
  format: isJson
    ? combine(timestamp(), errors({ stack: true }), splat(), json())
    : combine(
        timestamp(),
        errors({ stack: true }),
        splat(),
        isDev ? colorize() : winston.format.uncolorize(),
        logFormat
      ),
  transports: [new winston.transports.Console()],
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
const selectorTimeout = parseInt(process.env.SCREENIE_SELECTOR_TIMEOUT || '5000', 10);

const app = new Koa();
logger.log('verbose', 'Created KOA server');

const screenshotDelay = process.env.SCREENIE_SCREENSHOT_DELAY;

// Cluster will be launched asynchronously before starting the server
let cluster;

async function initCluster() {
  const maxConcurrency = parseInt(
    process.env.SCREENIE_POOL_MAX || process.env.SCREENIE_CLUSTER_MAX || '10',
    10
  );
  const minConcurrency = parseInt(
    process.env.SCREENIE_POOL_MIN || process.env.SCREENIE_CLUSTER_MIN || '2',
    10
  );

  cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT, // Each task = isolated incognito context
    maxConcurrency,
    puppeteerOptions: Object.assign({}, chromiumArgs, chromiumExec),
    monitor: false,
  });

  logger.log('verbose', 'Created Puppeteer cluster');

  // Pre-warm cluster by queueing empty tasks up to min concurrency
  for (let i = 0; i < minConcurrency; i++) {
    cluster.queue({ warmup: true, url: 'about:blank' });
  }

  // Define the cluster task which handles the full screenshot flow
  await cluster.task(async ({ page, data }) => {
    if (data.warmup) {
      return; // just open and close
    }

    const {
      url,
      width,
      height,
      format,
      fullPage,
      selector,
    } = data;

    if (url == null || url.trim() === '') {
      throw new Error('No url request parameter supplied.');
    }
    if (url.indexOf('file://') >= 0 && !allowFileScheme) {
      const err = new Error('File scheme not allowed');
      err.status = 403;
      throw err;
    }

    const size = {
      width: Math.min(2048, parseInt(width, 10) || imageSize.width),
      height: Math.min(2048, parseInt(height, 10) || imageSize.height),
    };
    await page.setViewport(size);

    logger.log('verbose', `[1] Attempting to load ${url}`);
    const response = await page.goto(url);
    const status = response.status();
    logger.log('verbose', `Status ${status}`);
    if (status < 200 || status > 299) {
      const err = new Error('Non-OK server response');
      err.status = status;
      throw err;
    }
    await page.evaluateHandle('document.fonts.ready');
    if (screenshotDelay) {
      await new Promise(r => setTimeout(r, screenshotDelay));
    }

    let chosenFormat = format || defaultFormat;
    if (supportedFormats.indexOf(chosenFormat.toLowerCase()) === -1) {
      const err = new Error(`Format ${chosenFormat} not supported.`);
      err.status = 400;
      throw err;
    }
    const lowerFormat = chosenFormat.toLowerCase();
    let output;
    logger.log('info', `Rendering screenshot of ${url} to ${lowerFormat}${selector ? ' (selector: ' + selector + ')' : ''}`);

    if (selector && lowerFormat === 'pdf') {
      const err = new Error('Selector screenshots are not supported for PDF output.');
      err.status = 400;
      throw err;
    }

    if (lowerFormat === 'pdf') {
      output = await page.pdf({
        format: 'A4',
        margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
      });
    } else {
      if (selector) {
        try {
          logger.log('verbose', `Waiting for selector '${selector}' (timeout ${selectorTimeout}ms)`);
          await page.waitForSelector(selector, { timeout: selectorTimeout, visible: true });
          const element = await page.$(selector);
          if (!element) {
            const err = new Error(`Selector '${selector}' not found`);
            err.status = 404;
            throw err;
          }
          output = await element.screenshot({
            type: lowerFormat === 'jpg' ? 'jpeg' : lowerFormat,
            omitBackground: true,
          });
        } catch (e) {
          if (/waiting for selector/.test(e.message) || e.name === 'TimeoutError') {
            const err = new Error(`Selector '${selector}' not found (timeout after ${selectorTimeout}ms)`);
            err.status = 404;
            throw err;
          }
          throw e;
        }
      } else {
        const clipInfo =
          fullPage === '1'
            ? { fullPage: true }
            : { clip: { x: 0, y: 0, width: size.width, height: size.height } };
        output = await page.screenshot(
          Object.assign(
            {
              type: lowerFormat === 'jpg' ? 'jpeg' : lowerFormat,
              omitBackground: true,
            },
            clipInfo
          )
        );
      }
    }
    return { output, format: lowerFormat };
  });

  process.on('SIGTERM', async () => {
    logger.log('info', 'Received SIGTERM, exiting...');
    try {
      await cluster.idle();
      await cluster.close();
    } catch (e) {
      logger.log('error', `Error during shutdown: ${e.message}`);
    } finally {
      process.exit(143);
    }
  });
}

// Unified middleware to process screenshot request
app.use(async ctx => {
  try {
    const { url, width, height, format, fullPage, selector } = ctx.request.query;
    const result = await cluster.execute({ url, width, height, format, fullPage, selector });
    ctx.type = result.format;
    ctx.body = result.output;
  } catch (e) {
    const status = e.status || 400;
    ctx.status = status;
    ctx.body = e.message;
    logger.log('error', e.message);
  }
});

initCluster()
  .then(() => {
    app.listen(serverPort, '0.0.0.0');
    logger.log('info', `Screenie server 0.0.0.0 started on port ${serverPort}`);
  })
  .catch(err => {
    logger.log('error', `Failed to start cluster: ${err.message}`);
    process.exit(1);
  });
