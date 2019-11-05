# 3.0.0-beta.2 / 05-11-2019

- _BREAKING_: Don't render screenshot for URLs that respond with error status.

# 3.0.0-beta.1 / 04-11-2019

- Support waiting for `document.fonts.ready` event.
- Make `SCREENIE_SCREENSHOT_DELAY` environment optional.

# 3.0.0-beta / 31-10-2019

- Use Alpine as base Docker image
- Update puppeteer to 1.19.0
- Update Koa to 2.11.0
- Update Winston to 3.2.1

# 2.0.0 / 30-01-2018

This is a major release which might require some more manual setup of
Chromium to make use of. Don't upgrade to this before you've _checked the
requirements_ of Chromium/Puppeteer, particularly when it comes to sandbox
support in your kernel for security.

- Switches to Chromium through Puppeteer over PhantomJS
- Support a custom delay after page load before screenshot is generated
- Support flag for enabling file protocol URLs

# 1.2.0 / 16-10-2017

- Add basic logging functionality
- Handle SIGTERM gracefully, draining the pool
- Added Dockerfile with CA certificate updates

# 1.1.0 / 17-03-2017

- Add PDF output support
- Add support to customize the output format with a `format` request parameter

# 1.0.0 / 06-02-2017

- Initial public release
