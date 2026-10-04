/**
 * Derived-annotation keys shared by loopy assists and views. Any plugin may write them and any
 * view may read them; values are plain arrays of indices into the puzzle's grid.
 */
export const KEYS = {
  /** number[] faces whose clue is broken. */
  badFaces: "loopy.badFaces",
  /** number[] dots with a branch or a dead end. */
  badVertices: "loopy.badVertices",
  /** number[] edges on a closed loop that isn't the finished answer. */
  strayLoop: "loopy.strayLoop",
  /** number[] dots where a line stops. */
  ends: "loopy.ends",
  /** number[] per edge: segment color index, -1 for none. */
  segments: "loopy.segments",
  /** number[] per face: 0 unknown, 1 inside, 2 outside. */
  sides: "loopy.sides",
  /** number[] faces whose clue is finished. */
  doneFaces: "loopy.doneFaces",
  /** number[] edges marked differently from the solution. */
  wrong: "loopy.wrong",
} as const;
