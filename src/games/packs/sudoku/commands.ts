import { bindCommands, bindingsOver, extrasOver, handlersOver, type CommandHandler, type Ids } from "../../core/commands";
import type { CommandDef } from "../../core/types";
import { DIGITS, digitsUpTo, type Digit } from "../../lib/digits";
import type { InputMode } from "./puzzle";
import {
  MODES, erase, fillCandidates, input, move, selectSame, setHighlight, setMode, setSelection, stepHighlight, type LatinSession,
} from "./input";

const INPUT = "sudoku: input";
const MARKS = "sudoku: marks";
const SELECT = "sudoku: selection";
const LOOK = "sudoku: highlight";

const MODE_HELP: Record<InputMode, string> = {
  digit: "digits and the pad write the answer into the selected cells",
  corner: "digits and the pad write small corner marks: where a digit could go (e.g. the two spots for a 5 in a box)",
  center: "digits and the pad write small center marks: which digits a cell could still be",
  color: "digits and the pad paint the selected cells, to track ideas; colors don't affect the answer",
};

const MODE_IDS = MODES.map((m) => m.id);
const modeOf = (id: InputMode) => MODES.find((m) => m.id === id)!;
const whole = "the selected cells, or the whole board when only one cell is selected";

/** The board's bindings for an n×n grid: digit commands exist for 1 … n (colors always 1 … 9). */
function bindingsFor(digits: readonly Digit[]) {
  return {
    ...bindingsOver("sudoku.mode-", MODE_IDS, (id) => ({ label: `${modeOf(id).label} mode`, category: INPUT, keys: [modeOf(id).key], description: MODE_HELP[id] })),
    "sudoku.clear": { label: "erase", category: INPUT, keys: ["delete", "backspace", "0"], description: "clear the selected cells: your digits first, then marks, then colors (colors first in color mode); givens stay" },
    ...bindingsOver("sudoku.d", digits, (d) => ({ label: `enter ${d}`, category: INPUT, keys: [String(d)], description: `put ${d} in the selected cells (as a digit, mark or color, depending on the input mode); again to take it out` })),
    ...bindingsOver("sudoku.corner-", digits, (d) => ({ label: `corner mark ${d}`, category: MARKS, hidden: true, description: `toggle a small ${d} in the corner of the selected cells, whatever the input mode (shift + ${d})` })),
    ...bindingsOver("sudoku.centre-", digits, (d) => ({ label: `center mark ${d}`, category: MARKS, keys: [`$mod+${d}`], hidden: true, description: `toggle a small ${d} in the middle of the selected cells, whatever the input mode` })),
    ...bindingsOver("sudoku.colour-", DIGITS, (d) => ({ label: `color ${d}`, category: MARKS, keys: [`alt+${d}`], hidden: true, description: `toggle color ${d} on the selected cells, whatever the input mode` })),
    "sudoku.mode-next": { label: "next input mode", category: INPUT, keys: ["space"], description: "cycle digit → corner → center → color" },
    "sudoku.fill-candidates": { label: "fill in candidates", category: MARKS, description: `write every digit that could still go in each empty cell as center marks, in ${whole}` },
    "sudoku.clear-colors": { label: "clear colors", category: MARKS, description: `remove colors from ${whole}` },
    "sudoku.up": { label: "move up", category: SELECT, keys: ["arrowup", "w"], description: "select the cell above (wraps around)" },
    "sudoku.down": { label: "move down", category: SELECT, keys: ["arrowdown", "s"], description: "select the cell below (wraps around)" },
    "sudoku.left": { label: "move left", category: SELECT, keys: ["arrowleft", "a"], description: "select the cell to the left (wraps around)" },
    "sudoku.right": { label: "move right", category: SELECT, keys: ["arrowright", "d"], description: "select the cell to the right (wraps around)" },
    "sudoku.extend-up": { label: "extend selection up", category: SELECT, keys: ["shift+arrowup"], description: "add the cell above to the selection" },
    "sudoku.extend-down": { label: "extend selection down", category: SELECT, keys: ["shift+arrowdown"], description: "add the cell below to the selection" },
    "sudoku.extend-left": { label: "extend selection left", category: SELECT, keys: ["shift+arrowleft"], description: "add the cell to the left to the selection" },
    "sudoku.extend-right": { label: "extend selection right", category: SELECT, keys: ["shift+arrowright"], description: "add the cell to the right to the selection" },
    "sudoku.select-all": { label: "select all", category: SELECT, keys: ["$mod+a"], description: "select every cell (e.g. to clear all marks at once)" },
    "sudoku.select-same": { label: "select cells with this digit", category: SELECT, keys: ["e"], description: "select every cell holding the same digit as the selected cell" },
    "sudoku.deselect": { label: "clear selection", category: SELECT, keys: ["escape"], description: "select nothing" },
    "sudoku.highlight-here": { label: "highlight this digit everywhere", category: LOOK, mouse: ["middleclick"], description: "keep this cell's digit lit up across the board while you select other cells; again to stop" },
    "sudoku.highlight-next": { label: "highlight next digit", category: LOOK, keys: ["bracketright"], description: "light up the next digit (1 → 2 → …) everywhere" },
    "sudoku.highlight-prev": { label: "highlight previous digit", category: LOOK, keys: ["bracketleft"], description: "light up the previous digit everywhere" },
    "sudoku.highlight-off": { label: "stop highlighting a digit", category: LOOK, description: "go back to lighting up the selected cell's digit" },
    ...bindingsOver("sudoku.highlight-", digits, (d) => ({ label: `highlight ${d}`, category: LOOK, hidden: true, description: `light up every ${d} on the board; again to stop` })),
  };
}

declare module "../../core/commands" {
  interface CommandNames extends Ids<ReturnType<typeof bindingsFor>> {}
}

/**
 * Everything the player can do on the board, as commands. `cellAt` maps a pointer event to the
 * cell under it (-1 when off the board); mouse-bound commands let other events through.
 */
export function boardCommands(session: LatinSession, cellAt: (e: Event | undefined) => number): CommandDef[] {
  const n = session.puzzle.n;
  const size = n * n;
  const digits = digitsUpTo(n);
  const onBoard = (e: Event | undefined, f: (cell: number) => void) => {
    const cell = cellAt(e);
    if (cell < 0) return false;
    f(cell);
    return undefined;
  };
  const highlightHere: CommandHandler = (_ctx, e) => {
    if (e instanceof MouseEvent && e.button === 1) return onBoard(e, (c) => setHighlight(session, session.state.values[c] || 0));
    setHighlight(session, session.state.values[session.interaction.cursor] || 0);
    return undefined;
  };
  const board = { menu: "board" } as const;
  return bindCommands(bindingsFor(digits), {
    ...handlersOver("sudoku.mode-", MODE_IDS, (id) => () => setMode(session, id)),
    "sudoku.clear": () => erase(session),
    ...handlersOver("sudoku.d", digits, (d) => () => input(session, d)),
    ...handlersOver("sudoku.corner-", digits, (d) => () => input(session, d, "corner")),
    ...handlersOver("sudoku.centre-", digits, (d) => () => input(session, d, "center")),
    ...handlersOver("sudoku.colour-", DIGITS, (d) => () => input(session, d, "color")),
    "sudoku.mode-next": () => {
      const i = MODES.findIndex((m) => m.id === session.interaction.mode);
      setMode(session, MODES[(i + 1) % MODES.length]!.id);
    },
    "sudoku.fill-candidates": () => fillCandidates(session),
    "sudoku.clear-colors": () => {
      const sel = session.interaction.selection;
      session.dispatch({ type: "clear", cells: sel.length > 1 ? sel : [...Array(size).keys()], layer: "colors" });
    },
    "sudoku.up": () => move(session, -1, 0, false),
    "sudoku.down": () => move(session, 1, 0, false),
    "sudoku.left": () => move(session, 0, -1, false),
    "sudoku.right": () => move(session, 0, 1, false),
    "sudoku.extend-up": () => move(session, -1, 0, true),
    "sudoku.extend-down": () => move(session, 1, 0, true),
    "sudoku.extend-left": () => move(session, 0, -1, true),
    "sudoku.extend-right": () => move(session, 0, 1, true),
    "sudoku.select-all": () => setSelection(session, [...Array(size).keys()]),
    "sudoku.select-same": () => selectSame(session, session.interaction.cursor),
    "sudoku.deselect": () => setSelection(session, []),
    "sudoku.highlight-here": highlightHere,
    "sudoku.highlight-next": () => stepHighlight(session, 1),
    "sudoku.highlight-prev": () => stepHighlight(session, -1),
    "sudoku.highlight-off": () => setHighlight(session, 0),
    ...handlersOver("sudoku.highlight-", digits, (d) => () => setHighlight(session, d)),
  }, {
    ...extrasOver("sudoku.mode-", MODE_IDS, (id) => ({ checked: () => session.interaction.mode === id })),
    "sudoku.clear": board,
    ...extrasOver("sudoku.d", digits, () => board),
    ...extrasOver("sudoku.corner-", digits, () => board),
    ...extrasOver("sudoku.centre-", digits, () => board),
    ...extrasOver("sudoku.colour-", DIGITS, () => board),
    "sudoku.fill-candidates": board,
    "sudoku.clear-colors": board,
    "sudoku.select-same": board,
    "sudoku.highlight-here": board,
    "sudoku.highlight-next": board,
    "sudoku.highlight-prev": board,
    "sudoku.highlight-off": { when: () => !!session.interaction.highlight },
    ...extrasOver("sudoku.highlight-", digits, (d) => ({ checked: () => session.interaction.highlight === d })),
  });
}
