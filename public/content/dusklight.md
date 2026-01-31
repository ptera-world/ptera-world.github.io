Universal UI client for arbitrary data sources with data-agnostic control plane. View any format - JSON, protobuf, msgpack, SSE, video, audio, binary - and trigger actions through format-agnostic adapters.

## What it is

A format-agnostic UI client. Dusklight doesn't know about specific data formats - it receives structural descriptions and renders appropriate interfaces. The control plane handles mutations, triggers, and interactions, all equally format-agnostic.

For rhi projects, dusklight serves as a unified dashboard: inspect world state, trigger extractions, monitor pipelines, view expression outputs - all through the same client pointing at different data sources.

## Key design decisions

- Data-format agnostic architecture
- Control plane equally format-agnostic
- Adapter-based extensibility
- Project hub pattern for ecosystem integration
