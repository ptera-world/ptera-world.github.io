Universal UI client with control plane.

## What it is

A format-agnostic UI client that can display and interact with arbitrary data sources. Dusklight doesn't know about specific data formats — it receives structural descriptions and renders appropriate interfaces.

The control plane handles:

- **Mutations** — write operations back to data sources
- **Triggers** — reactive updates when data changes
- **Interactions** — user actions mapped to backend operations

Dusklight serves as the unified dashboard for rhi projects, providing a single interface to inspect and control any project that exposes a compatible data source.

## What it isn't

- Not a web framework — it's a client application, not a library
- Not a specific dashboard — it adapts to whatever data you point it at
- Not a terminal UI — it's a graphical client with rich rendering

## Prior art

- [Grafana](https://grafana.com/) — multi-source dashboards
- [Retool](https://retool.com/) — internal tool builder
- [Datasette](https://datasette.io/) — data exploration tool

## Related projects

- [server-less](/server-less) — projects using server-less can expose dusklight-compatible interfaces
- [portals](/portals) — defines the capability interfaces dusklight consumes
