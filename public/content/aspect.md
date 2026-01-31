Card-based identity exploration sandbox. Local-first web app where everything is a card with edges, navigable as both an infinite graph and an experiential place. Real-time multiplayer via Y.js CRDTs.

## What it is

Every card is an atomic unit of existence - a place, trait, relationship, or state. Cards connect via typed directional edges. You navigate by following edges, edit by changing card content, and explore identity by building and rearranging the graph.

Features:

- **Canvas mode** - infinite pan/zoom graph diagram with drag, resize, edge-drag, brush selection, minimap
- **Projection mode** - experiential "place" view with location descriptions, categorized panels by edge type, breadcrumbs, drill-down navigation
- **World packs** - portable JSON definitions with kinds (icons, colors) and edge type constraints
- **Actions** - declarative when/do system with JSONLogic predicates for graph transformations
- **Multiplayer** - Y.js CRDT sync via WebSocket, room-scoped SQLite persistence, per-client undo/redo
- **Snapshots** - export/import full graph state as JSON

Built with vanilla TypeScript, direct DOM manipulation, Bun server with WebSocket + SQLite WAL mode. Size budget: <120 KB gzip.

## Related projects

- [hologram](/hologram) - aspect cards could define hologram entities and world structure
