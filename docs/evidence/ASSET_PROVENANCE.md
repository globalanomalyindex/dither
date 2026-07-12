# DITHER Asset Provenance

## Rules

- Every non-original asset requires source, license, purpose, and modification status.
- Product icons must be original editable SVG or a documented licensed source.
- Generated imagery must be labeled and cannot serve as product evidence.
- Font files must not be added without a verified redistribution license.
- Screenshots used as evidence must come from the actual tested build.

## Current assets

| Asset | Location or reference | Source | License | Modification | Purpose | Status |
|---|---|---|---|---|---|---|
| AstheticPixel font | `fonts/AstheticPixel-Regular.otf` | Not yet documented | Not yet documented | Unknown | Expressive pixel word treatment | Provenance required before release |
| Archivo web font | Baseline Google Fonts link, removed in Plan 0 | Google Fonts | Not required for the current runtime because the asset is no longer requested | Removed | Former primary sans-serif typography | Removed from runtime |
| JetBrains Mono web font | Baseline Google Fonts link, removed in Plan 0 | Google Fonts | Not required for the current runtime because the asset is no longer requested | Removed | Former numeric and technical readouts | Removed from runtime |
| System sans-serif and mono stacks | `style.css` fallback stacks | User operating system | Platform supplied | None | Current primary typography after remote-font removal | Active; cross-platform fit audit remains open |
| Existing interface glyphs | HTML text and CSS-drawn marks | Mixed original or system glyphs | Not applicable or not yet documented | Various | Controls and feedback | Audit for clarity and consistency |
| Product screenshots | Not yet assembled | Actual DITHER builds only | Project-owned | Crop and annotation only | Case-study evidence | Open |
| Curated editable sample | Not yet created | Must be project-owned or explicitly licensed | To be recorded | To be recorded | First-run exploration | Open for Plan 3 |
| Generated case-study art | None committed | Not applicable | Not applicable | Not applicable | Optional non-evidentiary presentation | Not used |
