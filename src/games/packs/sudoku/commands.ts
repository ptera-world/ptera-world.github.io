import type { CommandDef } from "../../core/types";
import {
  MODES, erase, fillCandidates, input, move, selectSame, setHighlight, setMode, setSelection, stepHighlight, type LatinSession,
} from "./input";

const INPUT = "sudoku: input";
const MARKS = "sudoku: marks";
const SELECT = "sudoku: selection";
const LOOK = "sudoku: highlight";

/**
 * Everything the player can do on the board, as commands. `cellAt` maps a pointer event to the
 * cell under it (-1 when off the board); mouse-bound commands let other events through.
 */
export function boardCommands(session: LatinSession, cellAt: (e: Event | undefined) => number): CommandDef[] {
  const n = session.puzzle.n;
  const size = n * n;
  const digits = [...Array(Math.max(n, 9)).keys()].map((i) => i + 1);
  const modeIs = (id: string) => () => session.interaction.mode === id;
  const onBoard = (e: Event | undefined, f: (cell: number) => void) => {
    const cell = cellAt(e);
    if (cell < 0) return false;
    f(cell);
    return undefined;
  };
  return [
    ...digits.filter((d) => d <= n).map((d): CommandDef => ({
      id: `sudoku.d${d}`, label: `enter ${d}`, category: INPUT, keys: [String(d)],
      run: () => input(session, d),
    })),
    ...digits.filter((d) => d <= n).map((d): CommandDef => ({
      id: `sudoku.corner-${d}`, label: `corner mark ${d}`, category: MARKS, hidden: true,
      run: () => input(session, d, "corner"),
    })),
    ...digits.filter((d) => d <= n).map((d): CommandDef => ({
      id: `sudoku.center-${d}`, label: `centre mark ${d}`, category: MARKS, keys: [`$mod+${d}`], hidden: true,
      run: () => input(session, d, "center"),
    })),
    ...digits.map((d): CommandDef => ({
      id: `sudoku.color-${d}`, label: `colour ${d}`, category: MARKS, keys: [`alt+${d}`], hidden: true,
      run: () => input(session, d, "color"),
    })),
    { id: "sudoku.clear", label: "erase", category: INPUT, keys: ["delete", "backspace", "0"], menu: "board", run: () => erase(session) },
    ...MODES.map((m): CommandDef => ({
      id: `sudoku.mode-${m.id}`, label: `${m.label} mode`, category: INPUT, keys: [m.key], menu: "board",
      checked: modeIs(m.id), run: () => setMode(session, m.id),
    })),
    {
      id: "sudoku.mode-next", label: "next input mode", category: INPUT, keys: ["space"],
      run: () => {
        const i = MODES.findIndex((m) => m.id === session.interaction.mode);
        setMode(session, MODES[(i + 1) % MODES.length]!.id);
      },
    },
    {
      id: "sudoku.fill-candidates", label: "fill in candidates", category: MARKS, menu: "board",
      description: "write every digit each empty cell can still hold as centre marks (in the selected cells, or everywhere if one cell is selected)",
      run: () => fillCandidates(session),
    },
    {
      id: "sudoku.clear-colors", label: "clear colours", category: MARKS, menu: "board",
      description: "remove colours from the selected cells, or from the whole board if one cell is selected",
      run: () => {
        const sel = session.interaction.selection;
        const cells = sel.length > 1 ? sel : [...Array(size).keys()];
        session.dispatch({ type: "clear", cells, layer: "colors" });
      },
    },
    { id: "sudoku.up", label: "move up", category: SELECT, keys: ["arrowup", "w"], run: () => move(session, -1, 0, false) },
    { id: "sudoku.down", label: "move down", category: SELECT, keys: ["arrowdown", "s"], run: () => move(session, 1, 0, false) },
    { id: "sudoku.left", label: "move left", category: SELECT, keys: ["arrowleft", "a"], run: () => move(session, 0, -1, false) },
    { id: "sudoku.right", label: "move right", category: SELECT, keys: ["arrowright", "d"], run: () => move(session, 0, 1, false) },
    { id: "sudoku.extend-up", label: "extend selection up", category: SELECT, keys: ["shift+arrowup"], run: () => move(session, -1, 0, true) },
    { id: "sudoku.extend-down", label: "extend selection down", category: SELECT, keys: ["shift+arrowdown"], run: () => move(session, 1, 0, true) },
    { id: "sudoku.extend-left", label: "extend selection left", category: SELECT, keys: ["shift+arrowleft"], run: () => move(session, 0, -1, true) },
    { id: "sudoku.extend-right", label: "extend selection right", category: SELECT, keys: ["shift+arrowright"], run: () => move(session, 0, 1, true) },
    { id: "sudoku.select-all", label: "select all", category: SELECT, keys: ["$mod+a"], run: () => setSelection(session, [...Array(size).keys()]) },
    {
      id: "sudoku.select-same", label: "select cells with this digit", category: SELECT, keys: ["e"], menu: "board",
      run: () => selectSame(session, session.interaction.cursor),
    },
    { id: "sudoku.deselect", label: "clear selection", category: SELECT, keys: ["escape"], run: () => setSelection(session, []) },
    {
      id: "sudoku.highlight-here", label: "highlight this digit everywhere", category: LOOK, mouse: ["middleclick"], menu: "board",
      description: "pin the highlight to the digit in the cell (clicked with the middle button, or selected); again to unpin",
      run: (_ctx, e) => {
        if (e instanceof MouseEvent && e.button === 1) return onBoard(e, (c) => setHighlight(session, session.state.values[c] || 0));
        setHighlight(session, session.state.values[session.interaction.cursor] || 0);
        return undefined;
      },
    },
    { id: "sudoku.highlight-next", label: "highlight next digit", category: LOOK, keys: ["bracketright"], run: () => stepHighlight(session, 1) },
    { id: "sudoku.highlight-prev", label: "highlight previous digit", category: LOOK, keys: ["bracketleft"], run: () => stepHighlight(session, -1) },
    {
      id: "sudoku.highlight-off", label: "stop highlighting a digit", category: LOOK,
      when: () => !!session.interaction.highlight, run: () => setHighlight(session, 0),
    },
    ...digits.filter((d) => d <= n).map((d): CommandDef => ({
      id: `sudoku.highlight-${d}`, label: `highlight ${d}`, category: LOOK, hidden: true,
      checked: () => session.interaction.highlight === d, run: () => setHighlight(session, d),
    })),
  ];
}
