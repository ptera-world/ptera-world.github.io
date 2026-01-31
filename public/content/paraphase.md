Type-driven data transformation pipeline.

## What it is

An automatic conversion route planner. Given a source format and a target format, paraphase finds the shortest path through available converters and executes the pipeline. Think of it as a router for data formats.

The CLI supports multiple format families:

- **serde** — structured data (JSON, TOML, YAML, etc.)
- **image** — raster image formats (PNG, JPEG, WebP, etc.)
- **video** — video container formats
- **audio** — audio formats and codecs

Converters are registered as plugins. Paraphase builds a graph of possible conversions and finds optimal paths automatically.

## What it isn't

- Not a file converter — it's a conversion *planner* that orchestrates converters
- Not format-specific — it works with any registered converter
- Not lossy by default — it tracks fidelity through conversion chains

## Prior art

- [pandoc](https://pandoc.org/) — universal document converter (paraphase generalizes this idea)
- [ffmpeg](https://ffmpeg.org/) — media conversion pipelines
- [ImageMagick](https://imagemagick.org/) — image format conversion

## Related projects

- [rescribe](/rescribe) — lossless document conversion (plugs into paraphase)
- [concord](/concord) — API codegen that could feed paraphase pipelines
