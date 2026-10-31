import type { Rng } from "../../core/rng";
import { effective } from "../../core/schema";
import type { Metric, PuzzleDef } from "../../core/types";
import type { DataAttribute, DataItem } from "../../core/types";
import { formatValue } from "../../lib/dataset/compare";
import { filter } from "../../lib/dataset/query";
import { spellingOf } from "../../lib/dataset/spelling";
import {
  board, candidates, currentRound, fitsGiven, foundCount, guessesOf, hardError, inRounds, isLost, isOpen, isOver, isSolved, kind, revealsShown, roundOver, shownAnswers, EARLIER, LATER, NEAR,
  type Given, type WordleAction, type WordleBoard, type WordleFocus, type WordleInteraction, type WordlePuzzle, type WordleState,
} from "./engine";
import { kindOf, drawAnswers, codeSymbols, type Entry, type Kind } from "./kinds";
import { ELSEWHERE, RIGHT } from "./marks";
import { cluesOf, FIRST, LOOKS, makeParams, MARKS, POSITIONAL, RANK, SPELLING, spelled, symbolsName, type DataSource, type Look, type Params, type Settings } from "./params";
import { sgtFormat } from "./formats";
import { presetsFor } from "./presets";

/** Values of an attribute boards can be split by, in its order. */
function splitValues(a: DataAttribute): (string | boolean)[] {
  return a.kind === "bool" ? [true, false] : (a.values ?? []).map((v) => v.value);
}

/** A board's given values in words ("fire", "gen 1 · fire"). */
export function givenLabel(attrs: readonly DataAttribute[], given: Given | undefined): string {
  if (!given) return "";
  return Object.entries(given).map(([k, x]) => {
    const a = attrs.find((q) => q.id === k);
    if (!a) return String(x);
    if (a.kind === "bool") return `${x ? "" : "not "}${a.label}`;
    return formatValue(a, a.kind === "set" ? [x as string] : (x as string));
  }).join(" · ");
}

/** The spelling length for a new puzzle: one the pool has enough answers of, at random within the range. */
function pickLength(data: DataSource, s: Settings, rng: Rng, need: number): number {
  if (!spelled(s)) return 0;
  const lo = Math.min(s.minLen, s.maxLen), hi = Math.max(s.minLen, s.maxLen);
  if (s.secret !== "items") return rng.range(lo, hi);
  const d = data.get(s.dataset);
  if (!d) throw new Error(`the ${s.dataset} dataset's pack isn't loaded`);
  const r = filter(d.items(), s.pool, d.attributes);
  if ("error" in r) throw new Error(`the filter: ${r.error}`);
  const counts = new Map<number, number>();
  for (const it of r.items) { const q = spellingOf(d, it); if (q && q.length >= lo && q.length <= hi) counts.set(q.length, (counts.get(q.length) ?? 0) + 1); }
  const ok = [...counts].filter(([, n]) => n >= need).map(([l]) => l).sort((a, b) => a - b);
  if (!ok.length) throw new Error(`nothing that can be hidden is spelled with ${lo === hi ? lo : `${lo} to ${hi}`} ${symbolsName(s, data)}${need > 1 ? ` often enough for ${need} answers` : ""}`);
  return rng.pick(ok);
}

function check(s: Settings): void {
  if (s.secret === "codes") {
    const syms = codeSymbols(s);
    if (s.symbols === "colors" && s.alphabet > 10) throw new Error("there are 10 colors at most");
    if (s.distinct && Math.max(s.minLen, s.maxLen) > syms.length) throw new Error(`with no symbol twice, a code can be at most ${syms.length} long`);
  }
  if (s.secret === "items" && !s.compare.length && !s.clues.length && !s.reveals.length) throw new Error("pick something to mark guesses on, something to show the answer by, or something wrong guesses reveal");
  if (s.compare.includes(RANK) && s.answer === "dodge") throw new Error("an answer that dodges can't rank guesses: pick a fixed answer");
  if (s.clues.length && s.answer === "dodge") throw new Error("an answer that dodges isn't chosen yet, so nothing can show it");
  if (s.clues.some((c) => c.startsWith("media:")) && !s.looks.length) throw new Error("pick at least one way to show a picture");
  if (s.secret === "items" && s.guess === "valid" && s.compare.some((c) => c !== SPELLING)) throw new Error("guesses that aren't the dataset's own can only be marked on spelling");
}

export function generate(data: DataSource, given: Settings, rng: Rng): WordlePuzzle {
  const s = effective(makeParams(data), given);
  check(s);
  const split = s.secret === "items" ? [s.split, s.split2].filter((x, i, all) => x !== "" && all.indexOf(x) === i) : [];
  const per = s.pair ? 2 : 1;
  const dodge = s.answer === "dodge";
  const streak = s.open === "rounds" && s.streak;
  let length = pickLength(data, s, rng, split.length || streak ? 1 : s.boards * per);
  const key = {};
  let k: Kind = kindOf(data, s, length, key);
  let boards: WordleBoard[];
  if (split.length) {
    const d = k.data!;
    const attr = (id: string) => d.attributes.find((a) => a.id === id)!;
    let cells: Given[] = [{}];
    for (const id of split) cells = cells.flatMap((g) => splitValues(attr(id)).map((x) => ({ ...g, [id]: x })));
    const all = k.universe() ?? [];
    const options = cells.map((given) => ({ given, cands: all.filter((e) => fitsGiven(k, e, given)) })).filter((c) => c.cands.length);
    // fewest candidates first, so a cell with few answers isn't left with none by its neighbours
    const order = options.map((_, i) => i).sort((x, y) => options[x]!.cands.length - options[y]!.cands.length || x - y);
    const used = new Set<string>();
    const answer = new Map<number, Entry>();
    for (const i of order) {
      const free = options[i]!.cands.filter((c) => !used.has(k.label(c)));
      if (!free.length) continue;
      const pick = rng.pick(free);
      used.add(k.label(pick));
      answer.set(i, pick);
    }
    boards = options.flatMap((o, i) => (answer.has(i) ? [{ answers: dodge ? [] : [answer.get(i)!], given: o.given }] : []));
    if (!boards.length) throw new Error("nothing that can be hidden has any of those values");
  } else if (dodge) {
    if (!k.universe()) throw new Error("too many possible answers to dodge with; make the code shorter or the alphabet smaller");
    boards = Array.from({ length: s.boards }, () => ({ answers: [] }));
  } else if (s.pair) {
    // pairs share no symbols (Xordle)
    const all = k.universe();
    boards = [];
    const taken = new Set<string>();
    for (let b = 0; b < s.boards; b++) {
      let pair: Entry[] | null = null;
      for (let tries = 0; tries < 2000 && !pair; tries++) {
        const [x] = drawAnswers(k, s, length, rng, 1, (e) => taken.has(k.label(e)));
        const xs = new Set(k.seqOf(x!.entry) ?? []);
        const rest = all ? all.filter((e) => !taken.has(k.label(e)) && !(k.seqOf(e) ?? []).some((c) => xs.has(c))) : null;
        if (rest && !rest.length) continue;
        const y = rest ? rng.pick(rest) : drawAnswers(k, s, length, rng, 1)[0]!.entry;
        if ((k.seqOf(y) ?? []).some((c) => xs.has(c))) continue;
        pair = [x!.entry, y];
      }
      if (!pair) throw new Error("no two answers without a symbol in common turned up; widen what can be hidden");
      pair.forEach((e) => taken.add(k.label(e)));
      boards.push({ answers: pair });
    }
  } else {
    const unshown = (e: Entry) => !!s.clues.length && !cluesFor(k, s, e).length;
    // a streak goes on until you miss, so it has every answer there is, up to the board count
    const n = streak ? Math.min(s.boards, (k.universe() ?? []).filter((e) => !unshown(e)).length || s.boards) : s.boards;
    boards = drawAnswers(k, s, length, rng, n, unshown).map((x) => ({ answers: [x.entry], ...(x.target !== undefined ? { target: x.target } : {}) }));
  }
  if (s.clues.length) {
    for (const bd of boards) {
      const ids = cluesFor(k, s, bd.answers[0]!);
      if (!ids.length) throw new Error("an answer has none of the things picked to show it by");
      const id = rng.pick(ids);
      const picture = k.data?.media?.[id.slice(6)]?.type === "image";
      bd.clue = { id, ...(picture ? { look: rng.pick(s.looks) as Look } : {}), spot: Math.floor(rng.next() * 1000) / 1000 };
    }
  }
  if (s.limit > 0 && s.goal === "find" && s.open !== "rounds" && s.limit < boards.length + s.starters) throw new Error(`${boards.length} boards need at least ${boards.length + s.starters} guesses`);
  // guesses filled in at random: valid guesses that aren't an answer
  const starters: Entry[] = [];
  const isAnswer = (e: Entry) => boards.some((b) => b.answers.some((a) => k.same(e, a)));
  for (let tries = 0; starters.length < s.starters && tries < s.starters * 200; tries++) {
    let e: Entry;
    if (k.named) { const it = rng.pick(k.named); e = { item: it.id }; }
    else e = drawAnswers(k, s, length, rng, 1)[0]!.entry;
    if (isAnswer(e) || starters.some((x) => k.label(x) === k.label(e)) || k.invalid(e, boards[0]?.target)) continue;
    starters.push(e);
  }
  // the kind was built against a throwaway key; the puzzle object gets its own
  length = k.length;
  return { s: { ...s }, length, split, boards, starters, seed: String(rng.int(2 ** 31)) };
}

/** The clues (of those picked) an answer can be shown by: media it has, text it has. */
function cluesFor(k: Kind, s: Settings, e: Entry): string[] {
  const it = e.item ? k.itemOf(e.item) : undefined;
  const d = k.data;
  if (!it || !d) return [];
  const have = new Set(cluesOf(d).map((c) => c.id));
  return s.clues.filter((id) => {
    if (!have.has(id)) return false;
    if (id.startsWith("media:")) return !!d.media?.[id.slice(6)]?.url(it);
    const v = it.values[id.slice(5)];
    return typeof v === "string" && v.trim() !== "";
  });
}

/** Why a guess can't be handed in, or null. */
export function guessError(data: DataSource, p: WordlePuzzle, st: WordleState, e: Entry, b: number): string | null {
  const k = kind(data, p);
  const why = k.invalid(e, p.boards[b]?.target ?? p.boards[0]?.target);
  if (why) return why;
  const on = inRounds(p) ? currentRound(p, st) : Math.min(b, p.boards.length - 1);
  if (inRounds(p) && roundOver(data, p, st, on)) return "this round is over";
  if (guessesOf(p, st, on).some((g) => k.label(g) === k.label(e))) return "already guessed";
  return hardError(data, p, st, on, e);
}

export function reduce(data: DataSource, p: WordlePuzzle, st: WordleState, a: WordleAction & { board?: number }): WordleState {
  if (isOver(data, p, st)) return st;
  const k = kind(data, p);
  switch (a.type) {
    case "guess":
      if (guessError(data, p, st, a.entry, a.board ?? 0)) return st;
      return { ...st, guesses: [...st.guesses, a.entry] };
    case "type": {
      const at = st.row.indexOf("");
      if (at < 0 || !k.keys.flat().includes(a.sym) && !(k.next(st.row.slice(0, at)) ?? []).includes(a.sym)) return st;
      const row = st.row.slice();
      row[at] = a.sym;
      return { ...st, row };
    }
    case "back": {
      const filled = st.row.filter((c) => c !== "").length;
      if (!filled) return st;
      const row = st.row.slice();
      const last = row.length - 1 - [...row].reverse().findIndex((c) => c !== "");
      row[last] = "";
      return { ...st, row };
    }
    case "row": {
      if (a.row.length !== st.row.length || a.row.every((c, i) => c === st.row[i])) return st;
      return { ...st, row: a.row.slice() };
    }
    case "submit": {
      const e: Entry = { seq: st.row.slice() };
      if (guessError(data, p, st, e, a.board ?? 0)) return st;
      return { ...st, guesses: [...st.guesses, e], row: st.row.map(() => "") };
    }
    case "next": {
      const c = currentRound(p, st);
      if (!inRounds(p) || !roundOver(data, p, st, c)) return st;
      return { ...st, starts: [...(st.starts ?? [0]), st.guesses.length], row: st.row.map(() => "") };
    }
    case "pass": {
      const c = currentRound(p, st);
      if (!inRounds(p) || roundOver(data, p, st, c)) return st;
      return { ...st, passed: [...(st.passed ?? []), c] };
    }
  }
  return st;
}

// --- words ---

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const an = (w: string) => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;

function nounOf(data: DataSource, s: Settings): { one: string; many: string } {
  if (s.secret === "codes") return { one: "code", many: "codes" };
  if (s.secret === "equations") return s.form === "target" ? { one: "calculation", many: "calculations" } : { one: "equation", many: "equations" };
  return data.get(s.dataset)?.noun ?? { one: "answer", many: "answers" };
}

export function rules(data: DataSource, p: WordlePuzzle): string[] {
  const s = p.s;
  const k = kind(data, p);
  const n = nounOf(data, s);
  const many = p.boards.length > 1;
  const sym = symbolsName(s, data);
  const out: string[] = [];
  const rounds = inRounds(p);
  if (rounds) out.push(s.streak ? `find ${n.many} one after another until you miss one; your score is how many you found.` : `find ${p.boards.length} ${n.many}, one after another; missing one moves you on.`);
  else out.push(many ? `${p.boards.length} ${n.many} are hidden, one on each board${s.pair ? " (two per board)" : ""}.` : s.pair ? `two ${n.many} are hidden; they share no ${sym}.` : `${an(n.one)} is hidden.`);
  if (s.clues.length) {
    const labels = cluesOf(k.data).filter((c) => s.clues.includes(c.id)).map((c) => (c.type === "image" ? `its ${c.label} (${s.looks.map((l) => LOOKS.find((x) => x.value === l)?.label ?? l).join(", or ")})` : `its ${c.label}${c.type === "text" ? ", with every name blanked out" : ""}`));
    out.push(`you see ${labels.length > 1 ? `one of: ${labels.join("; ")}` : labels[0]}.${s.ease ? " every wrong guess shows more of it." : ""}`);
  }
  if (s.reveals.length) out.push(`wrong guesses also reveal, one at a time: ${s.reveals.map((id) => (id === FIRST ? "the first letter" : k.data?.attributes.find((a) => a.id === id)?.label ?? id)).join(", ")}.`);
  if (s.answer === "dodge") out.push(`it isn't chosen yet: after each guess it is whichever ${n.one} keeps the most possibilities open, so every guess is marked as unhelpfully as the marks so far allow.`);
  if (p.split.length) out.push(`each board says what its ${n.one}'s ${p.split.map((id) => k.data?.attributes.find((a) => a.id === id)?.label ?? id).join(" and ")} is.`);
  if (p.boards[0]?.target !== undefined) out.push(`it is a calculation of ${p.length} symbols that comes to the number shown.`);
  else if (spelled(s)) out.push(`it has ${p.length} ${sym}.${s.reveal ? ` the first is shown.` : ""}`);
  const valid = s.secret === "items" && s.guess === "valid" ? `any ${p.length} ${sym} the dataset accepts, not only its ${n.many}` : null;
  if (rounds) out.push("you can give up on a round; it counts as missed.");
  out.push(`each guess must be ${k.named ? `one of the ${n.many} in the list` : s.secret === "equations" ? "a correct calculation" : valid ?? `${p.length} ${sym}${s.secret === "codes" ? (s.distinct ? ", no symbol twice" : "") : ` that spell ${s.guess === "pool" ? "one that can be hidden" : "one in the list"}`}`}${many && !rounds ? (s.open === "sequence" ? "; each counts on every open board, and the next board opens (with your guesses so far marked on it) once one is found" : "; each counts on every board") : ""}.`);
  if (spelled(s)) {
    const m = MARKS.find((x) => x.value === s.marks)!;
    out.push(`${sym} are marked ${m.label.replace(/^each position: /, "one by one: ").replace(/^counted: /, "with a count of ")}${s.marks === "warm" ? ` (near: within ${s.near})` : ""}. ${m.description}.`);
  }
  if (s.compare.includes(RANK)) {
    const d = k.data;
    const prof = d?.alike?.find((x) => x.id === s.alike);
    out.push(`each guess gets its rank among every ${n.one} that can be guessed: #1 is the answer, #2 the most alike. alike means ${prof ? prof.label : "sharing the main attributes"}. a map puts alike ones near each other; it is only roughly right, the ranks are exact.`);
  }
  if (k.attrs.length) out.push(`each guess is compared on ${k.attrs.map((a) => a.label).join(", ")}: right, ${s.close.length ? `close (within ${s.within}${s.by === "percent" ? "%" : ""}, on ${s.close.join(", ")}), ` : ""}shares some (lists), or wrong; an arrow says whether the answer's number is higher or lower.${s.slots ? " lists in order are marked slot by slot: right slot, the other slot, or not at all." : ""}`);
  if (s.lies === "one") out.push("one mark in every row is false, except on the row that finds the answer.");
  if (s.hard.length) out.push(`hard mode, checked against ${s.hardRows === "all" ? "every guess so far" : "the guess before"}: ${s.hard.map((r) => ({ keep: "right ones stay right", use: "found symbols are used again", move: "symbols move off places ruled out", exact: "exact counts once known", drop: "absent symbols are dropped", fit: "every guess could be the answer" })[r] ?? r).join("; ")}.`);
  if (p.starters.length) out.push(`the first ${plural(p.starters.length, "guess is", "guesses are")} filled in at random.`);
  if (s.goal === "avoid") out.push(s.limit ? `don't guess it: survive ${s.limit} guesses.` : "don't guess it: the game ends when you do.");
  else out.push(s.limit ? `you have ${s.limit} guesses${rounds ? " for each round" : many ? " for all the boards together" : ""}${s.overtime ? "; after that you can keep going, but it counts as lost" : ""}.` : "there is no guess limit.");
  return out;
}

const SQ = { [RIGHT]: "🟩", [ELSEWHERE]: "🟨", 0: "⬛", [EARLIER]: "🔼", [LATER]: "🔽" } as Record<number, string>;
/** Likeness bands as fractions of the way down the ranking: the answer, hot (top 3%), warm (top 15%), cold. */
export function bandOf(rank: number, n: number): "found" | "hot" | "warm" | "cold" {
  if (rank === 1) return "found";
  const q = (rank - 1) / Math.max(1, n - 1);
  return q <= 0.03 ? "hot" : q <= 0.15 ? "warm" : "cold";
}
const bandSquare = (rank: number, n: number) => ({ found: "🟩", hot: "🟧", warm: "🟨", cold: "🟥" })[bandOf(rank, n)];
const keycap = (n: number) => String(n).split("").map((ch) => `${ch}️⃣`).join("");

export function shareText(data: DataSource, p: WordlePuzzle, st: WordleState, name: string): string {
  const s = p.s;
  const solved = isSolved(data, p, st);
  if (inRounds(p)) {
    const found = foundCount(data, p, st);
    const marks = p.boards.map((_, b) => b).filter((b) => b <= currentRound(p, st) && roundOver(data, p, st, b)).map((b) => { const v = board(data, p, st, b); return v.solvedAt < 0 ? "🟥" : v.solvedAt === 0 ? "🟩" : "🟨"; });
    const lines: string[] = [];
    for (let i = 0; i < marks.length; i += 10) lines.push(marks.slice(i, i + 10).join(""));
    return [`${name} ${s.streak ? `streak ${found}` : `${found}/${p.boards.length}`}`, ...lines].join("\n");
  }
  const head = s.goal === "avoid" ? `${name} survived ${survived(data, p, st)}` : `${name} ${solved ? st.guesses.length : "X"}/${s.limit || "∞"}${s.hard.length ? "*" : ""}`;
  if (p.boards.length === 1) {
    const v = board(data, p, st, 0);
    const rows = v.marks.map((m) => [
      ...(m.pos ?? []).map((x) => (s.marks === "warm" && x === NEAR ? "🟧" : SQ[x] ?? "⬛")),
      ...(m.counts ? [m.counts.join("·")] : []),
      ...(m.attrs ?? []).map((f) => (f.verdict === "match" ? "🟩" : f.verdict === "miss" ? "⬛" : "🟨")),
      ...(m.rank ? [bandSquare(m.rank.rank, kind(data, p).likeness?.(p.boards[0]!.answers[0] ?? {})?.items.length ?? 1)] : []),
    ].join(m.counts && !m.pos ? " " : ""));
    return [head, ...rows].join("\n");
  }
  const cell = (b: number) => { const at = board(data, p, st, b).solvedAt; return at < 0 ? "🟥" : keycap(at + 1); };
  const width = p.split.length === 2 ? new Set(p.boards.map((b) => String(b.given?.[p.split[1]!]))).size : Math.min(8, Math.ceil(Math.sqrt(p.boards.length)));
  const lines: string[] = [];
  for (let i = 0; i < p.boards.length; i += width) lines.push(p.boards.slice(i, i + width).map((_, j) => cell(i + j)).join(" "));
  return [head, ...lines].join("\n");
}

/** Avoiding: guesses made before one found an answer. */
export function survived(data: DataSource, p: WordlePuzzle, st: WordleState): number {
  const at = Math.min(...p.boards.map((_, b) => { const f = board(data, p, st, b).foundAt.filter((x) => x >= 0); return f.length ? Math.min(...f) : Infinity; }));
  return Number.isFinite(at) ? at : st.guesses.length;
}

/** When nothing better applies: how many answers still fit the board with the fewest. */
function hint(data: DataSource, p: WordlePuzzle, st: WordleState) {
  if (isOver(data, p, st)) return null;
  // shown by a clue: one more fact about the answer, past the ones its wrong guesses revealed
  const k0 = kind(data, p);
  const c = currentRound(p, st);
  if (p.s.clues.length || !p.s.compare.length) {
    const it = p.boards[c]!.answers[0]?.item ? k0.itemOf(p.boards[c]!.answers[0]!.item!) : undefined;
    const shown = revealsShown(data, p, st, c);
    const d = k0.data;
    if (it && d && !(inRounds(p) && roundOver(data, p, st, c))) {
      const order = [...p.s.reveals, ...(d.featured ?? []), FIRST].filter((id, i, all) => all.indexOf(id) === i && !shown.includes(id));
      const id = order.find((x) => x === FIRST || (it.values[x] ?? null) !== null);
      if (id) return { message: revealText(d.attributes, it, id), level: 2, focus: { board: c } };
    }
  }
  // ranked: Contexto's hint, something halfway (by rank) between your best guess and the answer
  if (p.s.compare.includes(RANK)) {
    const l = k0.likeness?.(p.boards[c]!.answers[0] ?? {});
    if (l) {
      const guessed = new Set(guessesOf(p, st, c).map((g) => g.item));
      const best = Math.min(l.items.length + 1, ...board(data, p, st, c).marks.map((m) => m.rank?.rank ?? Infinity));
      const want = Math.max(1, Math.floor(best / 2));
      const byRank = l.close.map((x, i) => [x.rank, i] as const).filter(([, i]) => !guessed.has(l.items[i]!.id)).sort((x, y) => x[0] - y[0]);
      const below = byRank.filter(([r]) => r <= want && r < best);
      const pick = below.length ? below[below.length - 1] : byRank.find(([r]) => r >= want);
      if (pick) { const it = l.items[pick[1]]!; return { message: `try ${it.name}`, actions: [{ type: "guess" as const, entry: { item: it.id } }], level: 2, focus: { board: c } }; }
    }
  }
  if (!st.guesses.length) return null;
  const n = nounOf(data, p.s);
  const live = p.boards.map((_, b) => b).filter((b) => isOpen(data, p, st, b) && board(data, p, st, b).solvedAt < 0);
  const counted = live.map((b) => ({ b, c: candidates(data, p, st, b) })).filter((x): x is { b: number; c: Entry[] } => !!x.c).sort((x, y) => x.c.length - y.c.length || x.b - y.b);
  const first = counted[0];
  if (!first) return null;
  const k = kind(data, p);
  const where = p.boards.length > 1 ? ` on board ${first.b + 1}` : "";
  const head = `${plural(first.c.length, `${n.one} fits`, `${n.many} fit`)} every mark${where}`;
  const focus: WordleFocus = { board: first.b, rows: st.guesses.map((_, i) => i) };
  return { message: head, focus: { board: first.b }, level: 1, more: { message: first.c.length <= 6 ? `${head}: ${first.c.map((e) => k.label(e)).join(", ")}` : head, focus, level: 2 } };
}

/** A fact about an item, as revealed ("gen 1", "fire type", "starts with B"). */
export function revealText(attrs: readonly DataAttribute[], it: DataItem, id: string): string {
  if (id === FIRST) return `starts with ${it.name.charAt(0).toUpperCase()}`;
  const a = attrs.find((x) => x.id === id);
  if (!a) return "";
  const v = it.values[id] ?? null;
  if (a.kind === "text") return String(v ?? "");
  if (a.kind === "bool") return `${v ? "" : "not "}${a.label}`;
  return `${a.label}: ${formatValue(a, v)}`;
}

/** Per attribute: on which guess it was first marked right, averaged over the boards found. */
function metrics(data: DataSource, p: WordlePuzzle, st: WordleState): Metric[] {
  const k = kind(data, p);
  if (!k.attrs.length) return [];
  const sums = new Map<string, { sum: number; n: number }>();
  p.boards.forEach((_, b) => {
    const v = board(data, p, st, b);
    if (v.solvedAt < 0) return;
    k.attrs.forEach((a, i) => {
      const at = v.marks.findIndex((m) => m.attrs?.[i]?.verdict === "match");
      if (at < 0) return;
      const e = sums.get(a.id) ?? { sum: 0, n: 0 };
      sums.set(a.id, { sum: e.sum + at + 1, n: e.n + 1 });
    });
  });
  return [...sums].map(([id, v]) => ({ id: `first-right:${id}`, label: `${k.attrs.find((a) => a.id === id)?.label ?? id} right by guess`, value: v.sum / v.n, better: "lower" as const }));
}

export function wordleDef(data: DataSource): PuzzleDef<WordlePuzzle, WordleState, WordleAction, WordleInteraction, Params> {
  const params = makeParams(data);
  const name = "wordle";
  return {
    id: "wordle",
    name,
    aliases: [
      "dordle", "duordle", "quordle", "octordle", "sedecordle", "duotrigordle", "kilordle", "absurdle", "fibble", "xordle", "antiwordle", "survivle",
      "hello wordl", "hardle", "jotto", "lingo", "word peaks", "warmle", "nerdle", "mathler", "numberle", "primel", "mastermind", "bulls and cows",
      "pico fermi bagels", "pokédle", "pokedle", "squirdle", "chessguessr",
    ],
    tags: ["deduction", "words"],
    description: "find what's hidden from how your guesses are marked: a word, a pokémon, a chess opening, a code or an equation; one board or a thousand, honest marks or lying ones, a fixed answer or one that dodges.",
    datasetsOf: (p) => (p.s.secret === "items" ? [p.s.dataset] : []),
    generatorVersion: 1,
    params,
    get presets() { return presetsFor(data); },
    daily: { params: {} },
    // a guess, once marked, has told you what it told you: taking it back would only refund the guess
    irreversible: true,
    generate: (v, rng) => generate(data, v, rng),
    formats: [sgtFormat(params)],
    init: (p) => ({ guesses: p.starters.slice(), row: Array.from({ length: kind(data, p).named ? 0 : p.length }, () => ""), ...(inRounds(p) ? { starts: [0], passed: [] } : {}) }),
    initInteraction: () => ({ board: 0 }),
    reduce: (p, s, a) => reduce(data, p, s, a),
    isSolved: (p, s) => isSolved(data, p, s),
    isLost: (p, s) => isLost(data, p, s),
    isRetraction: (a) => a.type === "back",
    solve: (p, s) => {
      if (p.s.goal === "avoid" || p.s.answer === "dodge") return null;
      if (inRounds(p)) {
        const moves: WordleAction[] = [];
        for (let b = currentRound(p, s); b < p.boards.length; b++) {
          if (b === currentRound(p, s) && roundOver(data, p, s, b)) { if (board(data, p, s, b).solvedAt < 0) return null; }
          else moves.push({ type: "guess", entry: p.boards[b]!.answers[0]! });
          if (b < p.boards.length - 1) moves.push({ type: "next" });
        }
        return { moves };
      }
      const left = p.boards.flatMap((b, i) => b.answers.filter((_, j) => board(data, p, s, i).foundAt[j]! < 0));
      if (p.s.limit > 0 && !p.s.overtime && s.guesses.length + left.length > p.s.limit) return null;
      return { moves: left.map((entry) => ({ type: "guess" as const, entry })) };
    },
    hint: (p, s) => hint(data, p, s),
    describeAction: (p, a, _b, after) => {
      const k = kind(data, p);
      switch (a.type) {
        case "guess": return `guess ${k.label(a.entry)}`;
        case "type": return `type ${a.sym}`;
        case "back": return "delete";
        case "row": return `type ${a.row.map((c) => c || "_").join(" ")}`;
        case "submit": { const g = after.guesses.at(-1); return g ? `guess ${k.label(g)}` : "guess"; }
        case "next": return `on to round ${currentRound(p, after) + 1}`;
        case "pass": return "give up on this round";
      }
    },
    describe: (p) => {
      const n = p.boards.length;
      const k = kind(data, p);
      const what = p.s.secret === "items" ? (k.data?.name ?? p.s.dataset) : nounOf(data, p.s).many;
      return [what, ...(spelled(p.s) ? [`${p.length} ${symbolsName(p.s, data)}`] : []), ...(n > 1 ? [`${n} boards${p.s.open === "sequence" ? " in sequence" : ""}`] : []), p.s.limit ? `${p.s.limit} guesses` : "no guess limit"].join(", ");
    },
    rules: (p) => rules(data, p),
    score: (p, s) => {
      if (inRounds(p)) { const n = foundCount(data, p, s); return { value: n, label: p.s.streak ? `streak of ${n}` : `${n} of ${p.boards.length} found`, better: "higher" }; }
      if (p.s.goal === "avoid") { const n = survived(data, p, s); return { value: n, label: plural(n, "guess survived", "guesses survived"), better: "higher" }; }
      return isSolved(data, p, s) ? { value: s.guesses.length, label: plural(s.guesses.length, "guess", "guesses"), better: "lower" } : null;
    },
    shareText: (p, s) => shareText(data, p, s, name),
    metrics: (p, s) => metrics(data, p, s),
    rate: (p) => {
      const n = kind(data, p).universe()?.length;
      return n ? { label: `${n} possible`, score: Math.log2(Math.max(2, n)) * p.boards.length / Math.max(1, p.s.limit || 10) } : null;
    },
  };
}

export { POSITIONAL, shownAnswers };
