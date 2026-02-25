---
label: "paraphase"
description: "turns data from one shape into another"
url: https://docs.rhi.zone/paraphase
parent: ecosystem/rhi
status: fleshed-out
tags: [rust, data, infrastructure]
---

type-driven data transformation pipeline. you describe what you have and what you want, and paraphase finds the conversion path through available converters.

## what it is

a route planner for data conversion. you give it source properties and a target pattern, and it finds the shortest path through registered converters. supports serde formats (JSON, YAML, TOML, MessagePack, CBOR, and many more), images (PNG, JPEG, WebP, and others with resize/crop/watermark transforms), video (MP4, WebM, MKV via FFmpeg), and audio (WAV, FLAC, MP3, OGG, AAC).

workflows can be defined in YAML/TOML/JSON with auto-planning or explicit steps. converter backends are feature-flagged and extensible through a plugin registry.

## Related projects

- [rescribe](/project/rescribe) - lossless document conversion plugs into paraphase as a backend
