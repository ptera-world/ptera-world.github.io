import type { CommandDef } from "../../core/types";
import {
  MODES, erase, fillCandidates, input, move, selectSame, setHighlight, setMode, setSelection, stepHighlight, type LatinSession,
} from "./input";

const INPUT = "sudoku: input";
const MARKS = "sudoku: marks";
const SELECT = "sudoku: selection";
const LOOK = "sudoku: highlight";

const MODE_HELP: Record<string, string> = {
  digit: "digits and the pad write the answer into the selected cells",
  corner: "digits and the pad write small corner marks: where a digit could go (e.g. the two spots for a 5 in a box)",
  center: "digits and the pad write small centre marks: which digits a cell could still be",
  color: "digits and the pad paint the selected cells, to track ideas; colours don't affect the answer",
};

/**
 * Everything the player can do on the board, as commands. `cellAt` maps a pointer event to the
 * cell under it (-1 when off the board); mouse-bound commands let other events through.
 */
export function boardCommands(session: LatinSession, cellAt: (e: Event | undefined) => number): CommandDef[] {
  const n = session.puzzle.n;
  const size = n * n;
  const upTo = (k: number) => [...Array(k).keys()].map((i) => i + 1);
  const modeIs = (id: string) => () => session.interaction.mode === id;
  const onBoard = (e: Event | undefined, f: (cell: number) => void) => {
    const cell = cellAt(e);
    if (cell < 0) return false;
    f(cell);
    return undefined;
  };
  const whole = "the selected cells, or the whole board when only one cell is selected";
  return [
    ...MODES.map((m): CommandDef => ({
      id: `sudoku.mode-${m.id}`, label: `${m.label} mode`, category: INPUT, keys: [m.key], menu: "board",
      description: MODE_HELP[m.id], checked: modeIs(m.id), run: () => setMode(session, m.id),
    })),
    {
      id: "sudoku.clear", label: "erase", category: INPUT, keys: ["delete", "backspace", "0"], menu: "board",
      description: "clear the selected cells: your digits first, then marks, then colours (colours first in colour mode); givens stay",
      run: () => erase(session),
    },
    ...upTo(n).map((d): CommandDef => ({
      id: `sudoku.d${d}`, label: `enter ${d}`, category: INPUT, keys: [String(d)],
      description: `put ${d} in the selected cells (as a digit, mark or colour, depending on the input mode); again to take it out`,
      run: () => input(session, d),
    })),
    ...upTo(n).map((d): CommandDef => ({
      id: `sudoku.corner-${d}`, label: `corner mark ${d}`, category: MARKS, hidden: true,
      description: `toggle a small ${d} in the corner of the selected cells, whatever the input mode (shift + ${d})`,
      run: () => input(session, d, "corner"),
    })),
    ...upTo(n).map((d): CommandDef => ({
      id: `sudoku.center-${d}`, label: `centre mark ${d}`, category: MARKS, keys: [`$mod+${d}`], hidden: true,
      description: `toggle a small ${d} in the middle of the selected cells, whatever the input mode`,
      run: () => input(session, d, "center"),
    })),
    ...upTo(9).map((d): CommandDef => ({
      id: `sudoku.color-${d}`, label: `colour ${d}`, category: MARKS, keys: [`alt+${d}`], hidden: true,
      description: `toggle colour ${d} on the selected cells, whatever the input mode`,
      run: () => input(session, d, "color"),
    })),
    {
      id: "sudoku.mode-next", label: "next input mode", category: INPUT, keys: ["space"],
      description: "cycle digit → corner → centre → colour",
      run: () => {
        const i = MODES.findIndex((m) => m.id === session.interaction.mode);
        setMode(session, MODES[(i + 1) % MODES.length]!.id);
      },
    },
    {
      id: "sudoku.fill-candidates", label: "fill in candidates", category: MARKS, menu: "board",
      description: `write every digit that could still go in each empty cell as centre marks, in ${whole}`,
      run: () => fillCandidates(session),
    },
    {
      id: "sudoku.clear-colors", label: "clear colours", category: MARKS, menu: "board",
      description: `remove colours from ${whole}`,
      run: () => {
        const sel = session.interaction.selection;
        session.dispatch({ type: "clear", cells: sel.length > 1 ? sel : [...Array(size).keys()], layer: "colors" });
      },
    },
    { id: "sudoku.up", label: "move up", category: SELECT, keys: ["arrowup", "w"], description: "select the cell above (wraps around)", run: () => move(session, -1, 0, false) },
    { id: "sudoku.down", label: "move down", category: SELECT, keys: ["arrowdown", "s"], description: "select the cell below (wraps around)", run: () => move(session, 1, 0, false) },
    { id: "sudoku.left", label: "move left", category: SELECT, keys: ["arrowleft", "a"], description: "select the cell to the left (wraps around)", run: () => move(session, 0, -1, false) },
    { id: "sudoku.right", label: "move right", category: SELECT, keys: ["arrowright", "d"], description: "select the cell to the right (wraps around)", run: () => move(session, 0, 1, false) },
    { id: "sudoku.extend-up", label: "extend selection up", category: SELECT, keys: ["shift+arrowup"], description: "add the cell above to the selection", run: () => move(session, -1, 0, true) },
    { id: "sudoku.extend-down", label: "extend selection down", category: SELECT, keys: ["shift+arrowdown"], description: "add the cell below to the selection", run: () => move(session, 1, 0, true) },
    { id: "sudoku.extend-left", label: "extend selection left", category: SELECT, keys: ["shift+arrowleft"], description: "add the cell to the left to the selection", run: () => move(session, 0, -1, true) },
    { id: "sudoku.extend-right", label: "extend selection right", category: SELECT, keys: ["shift+arrowright"], description: "add the cell to the right to the selection", run: () => move(session, 0, 1, true) },
    {
      id: "sudoku.select-all", label: "select all", category: SELECT, keys: ["$mod+a"], menu: "board",
      description: "select every cell (e.g. to clear all marks at once)", run: () => setSelection(session, [...Array(size).keys()]),
    },
    {
      id: "sudoku.select-same", label: "select cells with this digit", category: SELECT, keys: ["e"], menu: "board",
      description: "select every cell holding the same digit as the selected cell",
      run: () => selectSame(session, session.interaction.cursor),
    },
    { id: "sudoku.deselect", label: "clear selection", category: SELECT, keys: ["escape"], menu: "board", description: "select nothing", run: () => setSelection(session, []) },
    {
      id: "sudoku.highlight-here", label: "highlight this digit everywhere", category: LOOK, mouse: ["middleclick"], menu: "board",
      description: "keep this cell's digit lit up across the board while you select other cells; again to stop",
      run: (_ctx, e) => {
        if (e instanceof MouseEvent && e.button === 1) return onBoard(e, (c) => setHighlight(session, session.state.values[c] || 0));
        setHighlight(session, session.state.values[session.interaction.cursor] || 0);
        return undefined;
      },
    },
    { id: "sudoku.highlight-next", label: "highlight next digit", category: LOOK, keys: ["bracketright"], description: "light up the next digit (1 → 2 → …) everywhere", run: () => stepHighlight(session, 1) },
    { id: "sudoku.highlight-prev", label: "highlight previous digit", category: LOOK, keys: ["bracketleft"], description: "light up the previous digit everywhere", run: () => stepHighlight(session, -1) },
    {
      id: "sudoku.highlight-off", label: "stop highlighting a digit", category: LOOK,
      description: "go back to lighting up the selected cell's digit",
      when: () => !!session.interaction.highlight, run: () => setHighlight(session, 0),
    },
    ...upTo(n).map((d): CommandDef => ({
      id: `sudoku.highlight-${d}`, label: `highlight ${d}`, category: LOOK, hidden: true,
      description: `light up every ${d} on the board; again to stop`,
      checked: () => session.interaction.highlight === d, run: () => setHighlight(session, d),
    })),
  ];
}
