/** Graph interaction settings — all behaviors are configurable. */
export interface Settings {
  /** Force layout reorganizes around focused node. */
  dynamicLayout: boolean;
  /** Only show local neighborhood around focus. */
  neighborhoodFocus: boolean;
  /** Highlight focused node and its connections. */
  focusHighlight: boolean;
  /** Render edges between nodes. */
  edgesVisible: boolean;
  /** Show card on first click (intermediate between graph and panel). */
  cardEnabled: boolean;
  /** Nodes grow when focused/nearby. */
  nodeGrowth: boolean;
  /** Show node text directly on canvas. */
  textOnCanvas: boolean;
}

const defaults: Settings = {
  dynamicLayout: true,
  neighborhoodFocus: false,
  focusHighlight: true,
  edgesVisible: true,
  cardEnabled: true,
  nodeGrowth: true,
  textOnCanvas: false,
};

let current: Settings = { ...defaults };

export function getSettings(): Readonly<Settings> {
  return current;
}

export function updateSettings(partial: Partial<Settings>): void {
  Object.assign(current, partial);
}

/** Load settings overrides from URL params (e.g. ?dynamicLayout=false). */
export function loadSettingsFromUrl(): void {
  const params = new URLSearchParams(location.search);
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    const val = params.get(key);
    if (val === "true") (current as unknown as Record<string, boolean>)[key] = true;
    if (val === "false") (current as unknown as Record<string, boolean>)[key] = false;
  }
}
