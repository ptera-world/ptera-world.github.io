import { expect, test } from "bun:test";
import { fromFen, legalMoves, parseSan, play, playSan, startPosition, toFen, toSan, toUci, START_FEN, type Position } from "./chess";

function perft(p: Position, depth: number): number {
  const moves = legalMoves(p);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(play(p, m), depth - 1);
  return n;
}

// counts from the Chess Programming Wiki's "Perft Results" page
const PERFT: [string, string, number[]][] = [
  ["start", START_FEN, [20, 400, 8902, 197281]],
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862, 4085603]],
  ["position 3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238, 674624]],
  ["position 4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467, 422333]],
  ["position 4 mirrored", "r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1", [6, 264, 9467]],
  ["position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379]],
  ["position 6", "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", [46, 2079, 89890]],
];

for (const [name, fen, counts] of PERFT) {
  test(`perft: ${name}`, () => {
    const p = fromFen(fen);
    counts.forEach((n, i) => expect(perft(p, i + 1)).toBe(n));
  }, 60000);
}

test("fen: round-trips, including after moves", () => {
  for (const [, fen] of PERFT) expect(toFen(fromFen(fen))).toBe(fen);
  const { position } = playSan(["e4", "c5", "Nf3"]);
  expect(toFen(position)).toBe("rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");
  expect(() => fromFen("8/8/8 w - - 0 1")).toThrow();
  expect(() => fromFen("8/8/8/8/8/8/8/8 w - - 0 1")).toThrow();
});

test("san: every legal move two plies deep in every perft position round-trips", () => {
  for (const [, fen] of PERFT) {
    const root = fromFen(fen);
    for (const p of [root, ...legalMoves(root).map((m) => play(root, m))]) {
      const legal = legalMoves(p);
      const sans = legal.map((m) => toSan(p, m, legal));
      expect(new Set(sans).size).toBe(sans.length);
      legal.forEach((m, i) => expect(parseSan(p, sans[i]!)).toEqual(m));
    }
  }
});

const sanAt = (fen: string, uci: string) => {
  const p = fromFen(fen);
  return toSan(p, legalMoves(p).find((m) => toUci(m) === uci)!);
};

test("san: disambiguation by file, by rank, by both", () => {
  // knights on b1 and f3 both reach d2; rooks on a1 and a5 both reach a3; queens on a1, a3, c1 all reach b2
  expect(sanAt("4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1", "b1d2")).toBe("Nbd2");
  expect(sanAt("4k3/8/8/R7/8/8/8/R3K3 w - - 0 1", "a1a3")).toBe("R1a3");
  expect(sanAt("4k3/8/8/8/8/Q7/8/Q1Q1K3 w - - 0 1", "a1b2")).toBe("Qa1b2");
  // a pinned knight doesn't count as a rival
  expect(sanAt("4k3/8/8/8/7b/2N3N1/8/4K3 w - - 0 1", "c3e4")).toBe("Ne4");
});

test("san: castling, en passant, promotion, check and mate", () => {
  expect(sanAt("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1")).toBe("O-O");
  expect(sanAt("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1c1")).toBe("O-O-O");
  expect(sanAt("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5d6")).toBe("exd6");
  expect(sanAt("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", "b7b8q")).toBe("b8=Q+");
  expect(sanAt("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", "b7b8n")).toBe("b8=N");
  const fools = playSan(["f3", "e5", "g4"]).position;
  expect(toSan(fools, parseSan(fools, "Qh4")!)).toBe("Qh4#");
  expect(legalMoves(play(fools, parseSan(fools, "Qh4")!))).toEqual([]);
});

test("rules: no castling through check, out of check, or after the rook moved; en passant into a pin is illegal", () => {
  const ucis = (fen: string) => legalMoves(fromFen(fen)).map(toUci);
  expect(ucis("4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1")).not.toContain("e1g1"); // f1 attacked
  expect(ucis("4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1")).toContain("e1c1");
  expect(ucis("4k3/4r3/8/8/8/8/8/R3K2R w KQ - 0 1")).not.toContain("e1c1"); // in check
  expect(ucis("1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1")).toContain("e1c1"); // only b1 attacked: allowed
  const p = playSan(["Rg1", "a6", "Rh1"], fromFen("4k3/p7/8/8/8/8/8/4K2R w K - 0 1")).position;
  expect(p.castling).toBe("");
  expect(ucis("8/8/8/K2pP2r/8/8/8/7k w - d6 0 1")).not.toContain("e5d6");
});

test("parseSan: lenient forms people write, strict where it matters", () => {
  const p = startPosition();
  expect(toUci(parseSan(p, "Nf3+!?")!)).toBe("g1f3");
  expect(toUci(parseSan(p, "Ngf3")!)).toBe("g1f3");
  expect(toUci(parseSan(p, "g1f3") ?? { from: 0, to: 0 })).not.toBe("g1f3"); // UCI isn't SAN
  expect(parseSan(p, "e5")).toBeNull();
  expect(parseSan(p, "Nd2")).toBeNull();
  expect(parseSan(p, "O-O")).toBeNull();
  const castle = fromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  expect(toUci(parseSan(castle, "0-0")!)).toBe("e1g1");
  const promo = fromFen("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1");
  expect(parseSan(promo, "b8")).toBeNull();
  expect(toUci(parseSan(promo, "b8Q")!)).toBe("b7b8q");
  // with pawns on d4 and e4 and a piece on e5, plain "e5" is not dxe5
  const pawns = fromFen("4k3/8/8/4n3/3PP3/8/8/4K3 w - - 0 1");
  expect(parseSan(pawns, "e5")).toBeNull();
  expect(toUci(parseSan(pawns, "dxe5")!)).toBe("d4e5");
  expect(toUci(parseSan(pawns, "de5")!)).toBe("d4e5");
  expect(() => playSan(["e4", "e4"])).toThrow(/move 2 "e4"/);
});
