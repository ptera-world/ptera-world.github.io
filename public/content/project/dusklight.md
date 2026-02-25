---
label: "dusklight"
description: "one interface that connects to anything"
url: https://docs.rhi.zone/dusklight
parent: ecosystem/rhi
status: planned
tags: [typescript, ui, creative]
---

universal UI client that can view any data source. JSON, protobuf, msgpack, SSE, video, audio, binary - it renders appropriate interfaces from structural descriptions without knowing specific formats.

## what it is

dusklight receives structural descriptions of data and figures out how to display it. the control plane handles mutations, triggers, and interactions, all equally format-agnostic. adapters connect it to new data sources.

for rhi projects it works as a unified dashboard where you can inspect world state, trigger extractions, monitor pipelines, and view expression outputs, all through the same client pointing at different sources.
