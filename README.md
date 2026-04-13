# screenie-server

HTTP screenshot service based on [Puppeteer](https://github.com/puppeteer/puppeteer).

Creates an HTTP server using [Koa](https://github.com/koajs/koa) (default port
`3000`). It renders pages and returns screenshots (PNG/JPEG) or PDFs on demand.
It now uses a shared browser cluster powered by
[puppeteer-cluster](https://github.com/thomasdondorf/puppeteer-cluster) for
efficient parallel processing instead of the old custom pool.

## Installation / Usage

You can install from npm and run the server manually:

```bash
npm install screenie-server
./node_modules/.bin/screenie
```

Or run it without a local install:

```bash
npx screenie-server
```

Alternatively, you can run the published container image from GitHub Container
Registry:

```bash
docker run --rm \
  -p 3000:3000 \
  -e SCREENIE_LOG_LEVEL=info \
  ghcr.io/mailmojo/screenie-server:latest
```

Previous images under `eliksir/screenie-server` on Docker Hub are deprecated.
If you prefer, you can still build your own image locally from the
[Dockerfile](Dockerfile). The container runs Chromium with `--no-sandbox` by
default because typical container runtimes lack the required user namespace /
seccomp configuration. If you run in a hardened environment that supports it,
you may remove `--no-sandbox` via `SCREENIE_CHROMIUM_ARGS`.

## Configuration

Then request a screenshot of an URL using the `url` query parameter:
`http://localhost:3000/?url=http://google.com/&format=jpeg`

The size of the screenshot can be customized through the `width` and `height`
query parameters, but will always be constrained within 2048x2048. The default
size used when the parameters are missing can be customized by environment
variables:

* `SCREENIE_WIDTH`: Default width, as integer, in pixels (default `1024`).
* `SCREENIE_HEIGHT`: Default height, as integer, in pixels (default `768`).

### Capturing a single element

You can capture only a specific DOM element by providing a CSS selector via the
`selector` query parameter. Instead of a full (or clipped) page screenshot, the
bounding box of the matched element will be returned. Example:
`http://localhost:3000/?url=https://example.com&selector=%23main-logo&format=png`

If the selector is not found within a timeout (default `5000ms`), a `404` is
returned. Element screenshots are not supported for PDF output; attempting to
combine `format=pdf` with `selector` will return `400`.

* `SCREENIE_SELECTOR_TIMEOUT`: Time in milliseconds to wait for the selector to appear (default `5000`).

The `format` query parameter can be used to request a specific format of the
screenshot. The supported formats are PNG, JPEG and even PDF. You can
also set the default format through an environment variable:

* `SCREENIE_DEFAULT_FORMAT`: Default format (default `jpeg`).

The browser cluster can be tuned with environment variables. Legacy variables
(`SCREENIE_POOL_MIN` / `SCREENIE_POOL_MAX`) are still accepted for backward
compatibility; new names are preferred:

* `SCREENIE_CLUSTER_MIN` (or legacy `SCREENIE_POOL_MIN`): Minimum warm contexts (default `2`).
* `SCREENIE_CLUSTER_MAX` (or legacy `SCREENIE_POOL_MAX`): Maximum concurrent cluster tasks (default `10`).

To control the level of logging that will be performed, customize the
`SCREENIE_LOG_LEVEL` environment variable. Supported values are `error`,
`warn`, `info`, `verbose`, `debug`, and `silly`, though only `info` and
`verbose` are currently in use.

* `SCREENIE_LOG_LEVEL`: Logging level (default `info`).
* `SCREENIE_LOG_FORMAT`: Set to `json` for structured JSON logs (default plain / colorized text in non‑production).

To open up file scheme in URL parameter:

* `SCREENIE_ALLOW_FILE_SCHEME`: Accepts `1`, `true`, `yes`, or `on` to allow `file://` URLs (default `false`).

Delay from the `load` event until the screenshot is taken. This can solve
issues with rendering (i.e. rendering webfonts) not being complete before the
screenshot.

* `SCREENIE_SCREENSHOT_DELAY`: Time in milliseconds (optional; waits after fonts are ready before capture).

And lastly, of course the HTTP port can be customized:

* `SCREENIE_PORT`: HTTP port (default `3000`).
* `SCREENIE_CHROMIUM_ARGS`: Extra Chromium launch args (default `--no-sandbox`).
* `SCREENIE_CHROMIUM_EXEC`: Path to system Chromium (auto-set in Docker image). If unset, Puppeteer will use its bundled browser (unless you skip download).
* `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` or `PUPPETEER_SKIP_DOWNLOAD`: Set to `true` to rely on system Chromium only (the Docker image does this by default).

## Docker

Run the published image from GitHub Container Registry:

```bash
docker run --rm \
  -p 3000:3000 \
  -e SCREENIE_LOG_LEVEL=info \
  ghcr.io/mailmojo/screenie-server:latest
```

Build locally if you want to customize the image yourself:

```bash
docker build -t screenie-server:local .
docker run --rm \
  -p 3000:3000 \
  -e SCREENIE_LOG_LEVEL=info \
  mailmojo/screenie-server:local
```

Then:

```bash
curl -o example.png "http://localhost:3000/?url=https://example.com&format=png"
```

If you want Puppeteer to download its own Chromium revision instead of using
the system package inside the image, build with:

```bash
docker build --build-arg PUPPETEER_SKIP_DOWNLOAD=false -t mailmojo/screenie-with-bundled .
```

## Contributing

We welcome contributions and suggestions.

* Issues: https://github.com/mailmojo/screenie-server/issues
* Pull requests: please include a concise description and, if possible, a short test scenario.
* For significant changes, consider opening an issue first to discuss scope.

## License

Published under the MIT license.

---

### Changelog Highlights (since 5.x)

* Migrated from custom puppeteer pool to `puppeteer-cluster` for improved concurrency.
* Updated runtime requirement to Node.js >= 20.
* Added structured logging option via `SCREENIE_LOG_FORMAT=json`.
* Modernized Docker image (non-root, system Chromium, smaller footprint).
* Added backward-compatible environment variable mapping for cluster sizing.
