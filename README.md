# screenie-server

HTTP screenshot service based on [PhantomJS](https://github.com/amir20/phantomjs-node).

Creates a HTTP server using [Koa](https://github.com/koajs/koa), by default on
port 3000. Additionally a pool of PhantomJS instances will be created to render
pages and create screenshots of them on requests.

## Install

```bash
npm install screenie-server
```

## Usage

```bash
./node_modules/.bin/screenie-server
```

Then request a screenshot of an URL using the `url` query parameter:
`http://localhost:3000/?url=http://google.com/`

The default size of the screenshot created is 1024x768. This can be customized
through the `width` and `height` query parameters, but will be constrained
within 2048x2048.

Alternatively you can customize the default size and image type using
environment variables:

- `SCREENIE_WIDTH`: Default width, as integer, in pixels.
- `SCREENIE_HEIGHT`: Default height, as integer, in pixels.
- `SCREENIE_IMAGE_TYPE`: Image type, one of `jpeg`, `png` or `gif`.

The PhantomJS pool can also be customized with environment variables:

- `SCREENIE_POOL_MIN`: Minimum number of PhantomJS instances.
- `SCREENIE_POOL_MAX`: Maximum number of PhantomJS instances.

And lastly, of course the HTTP port can be customized:

- `SCREENIE_PORT`: HTTP port, defaults to 3000.

## Contributing

We are open to contributions or suggestions. File issues or suggestions on the
[GitHub issues page](https://github.com/eliksir/screenie-server/issues), and
please do submit a pull request if you have the time to implement an
improvement or bugfix.

## License

Published under the MIT license.
