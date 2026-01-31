Type-driven data transformation pipeline orchestrator. Given source and target properties, automatically finds conversion paths through available converters.

## What it is

A route planner for data conversion. You describe what you have (Properties) and what you want (PropertyPattern), and paraphase finds the shortest path through registered converters. Think of it as a router for data formats.

Supported format families:

- **Serde** - JSON, YAML, TOML, RON, JSON5, XML, S-expressions, URL-encoded, MessagePack, CBOR, Bincode, Postcard, BSON, FlexBuffers, Bencode, Pickle, Property Lists
- **Image** - PNG, JPEG, WebP, GIF, BMP, ICO, TIFF, TGA, PNM, Farbfeld, QOI, AVIF, OpenEXR, Radiance HDR
- **Video** - MP4, WebM, MKV, AVI, MOV, GIF (requires FFmpeg)
- **Audio** - WAV, FLAC, MP3, OGG, AAC

Image transforms: resize, scale, crop (aspect + gravity), watermark. Workflows in YAML/TOML/JSON with auto-planning or explicit steps.

## Key design decisions

- Type-driven via Properties and PropertyPattern matching
- Automatic path finding removes need for manual pipeline specification
- Feature-flagged converter backends
- Registry system for extensibility via plugins

## Related projects

- [rescribe](/rescribe) - lossless document conversion plugs into paraphase as a backend
