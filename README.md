# dither

a browser-based image dithering studio. zero-build, client-side, no dependencies.

**live:** https://globalanomalyindex.github.io/dither/

## what it does

- a large library of dithering algorithms (ordered, error-diffusion, and more)
- film grain and noise grain overlays
- paintstroke engine: paint over the dithered image with brushes; a pickup tool re-samples pixels from the image so you paint with the image's own colors
- color and tone controls: tone lock, palette extraction
- image export to png

## run locally

it is fully static, so serve the repo root with any static file server:

```
python3 serve.py
```

then open the url it prints. any other static server works too (`npx serve`, `python3 -m http.server`, and so on). no build step, no install.

## tech

vanilla javascript, html, css. no bundler, no build step, no dependencies.

## project layout

```
index.html        shell and ui markup
app.js            application logic and ui wiring
style.css         all styles
dither.js         dithering algorithm implementations
engine.js         image processing pipeline
grain.js          film and noise grain
paintstroke.js    paint engine and pickup tool
serve.py          local dev server (python)
fonts/            local font files
```

repo: https://github.com/globalanomalyindex/dither
