Federation protocol for persistent worlds.

## What it is

A protocol that enables Lotus servers (persistent world instances) to form interconnected networks. Interconnect solves the hard problem of multi-server virtual worlds: how do you let players travel between independently-operated worlds without complex distributed state?

The key insight is **single-authority ownership**: each world instance owns its state completely. When a player crosses between worlds, their state is transferred — not replicated. This avoids the consistency problems of distributed state while enabling seamless travel.

## What it isn't

- Not a game server — it's a protocol for connecting game servers
- Not a database — state lives in individual world instances
- Not peer-to-peer — it uses server-to-server federation (like email or ActivityPub)

## Prior art

- [ActivityPub](https://www.w3.org/TR/activitypub/) — federation protocol for social networks
- [Matrix](https://matrix.org/) — decentralized communication protocol
- [SpatialOS](https://ims.improbable.io/) — distributed world simulation (now defunct)

## Related projects

- [moonlet](/moonlet) — Lotus world state management runs on moonlet
- [playmate](/playmate) — game primitives for worlds connected via interconnect
