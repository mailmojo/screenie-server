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
const defaultWidth = parseInteger(process.env.SCREENIE_WIDTH, 1024);
const defaultHeight = parseInteger(process.env.SCREENIE_HEIGHT, 768);
const imageSize = {
  width: defaultWidth,
  height: defaultHeight,
};
const serverPort = parseInteger(process.env.SCREENIE_PORT, 3000);
const supportedFormats = ['jpg', 'jpeg', 'pdf', 'png'];
const allowFileScheme = parseBoolean(process.env.SCREENIE_ALLOW_FILE_SCHEME);
const screenshotDelay = parseInteger(process.env.SCREENIE_SCREENSHOT_DELAY, 0);
const selectorTimeout = Math.max(parseInteger(process.env.SCREENIE_SELECTOR_TIMEOUT, 5000), 0);
const maxConcurrency = parseInteger(
  process.env.SCREENIE_POOL_MAX || process.env.SCREENIE_CLUSTER_MAX,
  10
);
const minConcurrency = Math.min(
  Math.max(
    parseInteger(process.env.SCREENIE_POOL_MIN || process.env.SCREENIE_CLUSTER_MIN, 2),
    0
  ),
  maxConcurrency
);

const app = new Koa();
logger.log('verbose', 'Created KOA server');

// Cluster will be launched asynchronously before starting the server
let cluster;
let server;
let isShuttingDown = false;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseBoolean(value) {
  if (value == null) {
    return false;
  }

  switch (String(value).trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
}

function getViewportSize(width, height) {
  return {
    width: Math.max(1, Math.min(2048, parseInteger(width, imageSize.width))),
    height: Math.max(1, Math.min(2048, parseInteger(height, imageSize.height))),
  };
}

function normalizeFormat(format) {
  const requestedFormat = (format || defaultFormat).toLowerCase();
  if (!supportedFormats.includes(requestedFormat)) {
    throw new HttpError(400, `Format ${format || defaultFormat} not supported.`);
  }

  return requestedFormat === 'jpg' ? 'jpeg' : requestedFormat;
}

function normalizeUrl(rawUrl) {
  if (rawUrl == null || rawUrl.trim() === '') {
    throw new HttpError(400, 'No url request parameter supplied.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (error) {
    throw new HttpError(400, `Invalid url request parameter: ${error.message}`);
  }

  if (parsedUrl.protocol === 'file:') {
    if (!allowFileScheme) {
      throw new HttpError(403, 'File scheme not allowed.');
    }

    return parsedUrl.toString();
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new HttpError(400, `Unsupported URL protocol: ${parsedUrl.protocol}`);
  }

  return parsedUrl.toString();
}

function normalizeSelector(rawSelector) {
  if (rawSelector == null) {
    return null;
  }

  const selector = rawSelector.trim();
  if (selector === '') {
    throw new HttpError(400, 'Empty selector request parameter supplied.');
  }

  return selector;
}

function supportsResponseStatus(targetUrl) {
  return targetUrl.startsWith('http://') || targetUrl.startsWith('https://');
}

async function initCluster() {
  cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency,
    puppeteerOptions: Object.assign({}, chromiumArgs, chromiumExec),
    monitor: false,
  });

  logger.log('verbose', 'Created Puppeteer cluster');

  await cluster.task(async ({ page, data }) => {
    if (data.warmup) {
      await page.goto('about:blank');
      return;
    }

    const { url, width, height, format, fullPage, selector } = data;
    const targetUrl = normalizeUrl(url);
    const outputFormat = normalizeFormat(format);
    const requestedSelector = normalizeSelector(selector);
    const size = getViewportSize(width, height);
    const useFullPage = parseBoolean(fullPage);

    if (requestedSelector && outputFormat === 'pdf') {
      throw new HttpError(400, 'Element screenshots are not supported for PDF output.');
    }

    await page.setViewport(size);

    logger.log('verbose', `Attempting to load ${targetUrl}`);

    let response;
    try {
      response = await page.goto(targetUrl);
    } catch (error) {
      throw new HttpError(500, `Could not load page: ${error.message}`);
    }

    if (supportsResponseStatus(targetUrl)) {
      if (!response) {
        throw new HttpError(500, 'Could not load page: missing navigation response.');
      }

      const status = response.status();
      logger.log('verbose', `Status ${status}`);
      if (status < 200 || status > 299) {
        throw new HttpError(status, `Could not load page: upstream returned ${status}.`);
      }
    }

    let element;
    if (requestedSelector) {
      try {
        element = await page.waitForSelector(requestedSelector, { timeout: selectorTimeout });
      } catch (error) {
        if (error?.name === 'TimeoutError') {
          throw new HttpError(404, `Selector not found: ${requestedSelector}`);
        }

        throw new HttpError(400, `Invalid selector request parameter: ${error.message}`);
      }
    }

    await page.evaluate(() => globalThis.document?.fonts?.ready ?? Promise.resolve());

    if (screenshotDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, screenshotDelay));
    }

    logger.log(
      'info',
      `Rendering screenshot of ${targetUrl}${requestedSelector ? ` using selector ${requestedSelector}` : ''} to ${outputFormat}`
    );

    try {
      if (outputFormat === 'pdf') {
        return {
          output: await page.pdf({
            format: 'A4',
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
            printBackground: true,
          }),
          format: outputFormat,
        };
      }

      if (requestedSelector) {
        const boundingBox = await element.boundingBox();
        if (!boundingBox) {
          throw new HttpError(
            400,
            `Could not render element: selector ${requestedSelector} does not have a visible bounding box.`
          );
        }

        return {
          output: await element.screenshot({
            type: outputFormat,
            omitBackground: true,
          }),
          format: outputFormat,
        };
      }

      const screenshotOptions = useFullPage
        ? { fullPage: true }
        : { clip: { x: 0, y: 0, width: size.width, height: size.height } };

      return {
        output: await page.screenshot(
          Object.assign(
            {
              type: outputFormat,
              omitBackground: true,
            },
            screenshotOptions
          )
        ),
        format: outputFormat,
      };
    } catch (error) {
      throw new HttpError(400, `Could not render page: ${error.message}`);
    }
  });

  cluster.on('taskerror', (error, data, willRetry) => {
    logger.log(
      'error',
      `Task error for ${data?.url || 'unknown url'}: ${error.message}${willRetry ? ' (will retry)' : ''}`
    );
  });

  for (let i = 0; i < minConcurrency; i += 1) {
    cluster.queue({ warmup: true });
  }

  if (minConcurrency > 0) {
    await cluster.idle();
  }
}

function closeServer() {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.log('info', `Received ${signal}, exiting...`);

  try {
    await closeServer();
    if (cluster) {
      await cluster.idle();
      await cluster.close();
    }
  } catch (error) {
    logger.log('error', `Error during shutdown: ${error.message}`);
  } finally {
    process.exit(signal === 'SIGTERM' ? 143 : 130);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    const status = error.status || 500;

    ctx.status = status;
    ctx.type = 'text/plain; charset=utf-8';
    ctx.body = status >= 500 && !(error instanceof HttpError) ? 'Internal Server Error' : error.message;

    if (status >= 500) {
      ctx.app.emit('error', error, ctx);
    }
  }
});

app.use(async ctx => {
  const { url, width, height, format, fullPage, selector } = ctx.request.query;
  const result = await cluster.execute({ url, width, height, format, fullPage, selector });

  ctx.type = result.format;
  ctx.body = result.output;
});

app.on('error', error => {
  logger.log('error', error);
});

initCluster()
  .then(() => {
    server = app.listen(serverPort, '0.0.0.0');
    logger.log('info', `Screenie server started on 0.0.0.0:${serverPort}`);
  })
  .catch(err => {
    logger.log('error', `Failed to start cluster: ${err.message}`);
    process.exit(1);
  });
