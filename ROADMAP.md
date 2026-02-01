# Roadmap: Interactivity & Guided Thinking

## High-leverage

### 1. Back/forward navigation (history stack)
`history.pushState` on each focus change so browser back/forward retraces the exploration path. `?focus=` already exists for deep-linking — wire it into a proper history stack.

### 2. Keyboard-driven traversal
Arrow keys or `j`/`k` to walk between connected nodes. Creates a sequential thinking mode alongside the freeform spatial one. Lets visitors "follow the thread" without precise pointer targeting.

### 3. Guided entry path
Subtle onboarding nudge for first-time visitors — e.g. "scroll to zoom, click to explore" hint, or a pulse on anchor nodes. The landing message is passive; this gives an actual affordance cue.

### 4. Search / jump-to-node
`/`-triggered search overlay to find nodes by name. Solves "zoomed out and lost" and helps visitors who arrive with intent.

### 5. Path highlighting between nodes
When viewing a card's related links, visually highlight the edge path to those nodes. Builds on existing strength-based edge rendering to make graph structure legible.

## Lower priority

- **Mini-map** in corner for spatial orientation at deep zoom
- **Right-click context menu** to skip card → go straight to panel
- **Filter persistence** via URL params (shareable filter state)
- **Accessibility** — ARIA labels, keyboard focus management
