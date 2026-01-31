# pteraworld

Personal website. Graph-inspired navigation - not pages, not a literal graph editor.

Projects, ideas, and ecosystems rendered as a spatial field with tiers of detail. Zoom changes what's visible. Proximity implies relationship. Click to focus, scroll to recontextualize.

## Worlds

- **[rhi](https://docs.rhi.zone)** - glue layer for computers
- **[exo](https://docs.exo.place)** - places to exist

## Concept

Traditional portfolio sites are lists of pages. Graph editors are powerful but have high onboarding cost. This sits between: a spatial canvas where nodes have presence and hierarchy, but interaction is just point-and-zoom.

**Tiers** control detail density:
- **Far** - ecosystems as colored regions (rhi, exo)
- **Mid** - projects as nodes with names and one-line descriptions
- **Near** - expanded detail, links, status

Projections shift dynamically - the layout isn't fixed. What's "nearby" depends on what you're focused on. A project's neighbors change based on whether you approached it from its ecosystem, its tech stack, or its problem domain.

## Development

```bash
bun install
bun run dev
```

## License

MIT
