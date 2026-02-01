declare module "keybinds" {
  export interface Command {
    id: string;
    label: string;
    description?: string;
    category?: string;
    keys?: string[];
    mouse?: string[];
    when?: (ctx: Record<string, unknown>) => boolean;
    execute: (ctx: Record<string, unknown>, event?: Event) => unknown;
    hidden?: boolean;
    captureInput?: boolean;
  }

  export type Schema = Record<string, {
    label: string;
    description?: string;
    category?: string;
    keys?: string[];
    mouse?: string[];
    hidden?: boolean;
    captureInput?: boolean;
  }>;

  export function keybinds(
    commands: Command[],
    getContext?: () => Record<string, unknown>,
    options?: { target?: EventTarget },
  ): () => void;

  export function defineSchema<T extends Schema>(schema: T): T;

  export function fromBindings(
    bindings: Schema,
    handlers: Record<string, (ctx: Record<string, unknown>, event?: Event) => unknown>,
    options?: Record<string, { when?: (ctx: Record<string, unknown>) => boolean; captureInput?: boolean }>,
  ): Command[];

  export function fuzzyMatcher(query: string, text: string): { score: number; positions?: number[] } | null;

  export function registerComponents(): void;

  export class CommandPalette extends HTMLElement {
    commands: Command[];
    context: Record<string, unknown>;
    open: boolean;
    placeholder: string;
    matcher: ((query: string, text: string) => { score: number; positions?: number[] } | null) | undefined;
  }

  export class KeybindCheatsheet extends HTMLElement {
    commands: Command[];
    context: Record<string, unknown>;
    open: boolean;
  }
}
