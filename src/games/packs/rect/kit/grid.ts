/** Orthogonal neighbours of every cell of a w×h grid. */
export function neighbours(w: number, h: number): number[][] {
  return Array.from({ length: w * h }, (_, i) => {
    const x = i % w, y = Math.floor(i / w);
    const out: number[] = [];
    if (y > 0) out.push(i - w);
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (y < h - 1) out.push(i + w);
    return out;
  });
}

/** Rows then columns of a w×h grid, each as its cells in order. */
export function gridLines(w: number, h: number): number[][] {
  const lines: number[][] = [];
  for (let y = 0; y < h; y++) lines.push(Array.from({ length: w }, (_, x) => y * w + x));
  for (let x = 0; x < w; x++) lines.push(Array.from({ length: h }, (_, y) => y * w + x));
  return lines;
}

/** Connected pieces of the cells `open` accepts: per cell its piece id (-1 when not open), and the piece count. */
export function pieces(nbrs: readonly number[][], open: (c: number) => boolean): { id: Int32Array; count: number } {
  const id = new Int32Array(nbrs.length).fill(-1);
  let count = 0;
  for (let s = 0; s < nbrs.length; s++) {
    if (id[s] !== -1 || !open(s)) continue;
    const stack = [s];
    id[s] = count;
    while (stack.length) {
      const c = stack.pop()!;
      for (const d of nbrs[c]!) {
        if (id[d] === -1 && open(d)) {
          id[d] = count;
          stack.push(d);
        }
      }
    }
    count++;
  }
  return { id, count };
}

/** Cells whose removal splits the piece of `open` cells they belong to (articulation points). */
export function cutVertices(nbrs: readonly number[][], open: (c: number) => boolean): Uint8Array {
  const n = nbrs.length;
  const disc = new Int32Array(n).fill(-1), low = new Int32Array(n);
  const cut = new Uint8Array(n);
  let time = 0;
  for (let root = 0; root < n; root++) {
    if (disc[root] !== -1 || !open(root)) continue;
    // stack entries: cell, parent, index of the next neighbour to visit
    const stack: [number, number, number][] = [[root, -1, 0]];
    disc[root] = low[root] = time++;
    let rootKids = 0;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const [c, parent] = top;
      if (top[2] < nbrs[c]!.length) {
        const d = nbrs[c]![top[2]++]!;
        if (!open(d) || d === parent) continue;
        if (disc[d] === -1) {
          disc[d] = low[d] = time++;
          if (c === root) rootKids++;
          stack.push([d, c, 0]);
        } else low[c] = Math.min(low[c]!, disc[d]!);
        continue;
      }
      stack.pop();
      if (parent >= 0) {
        low[parent] = Math.min(low[parent]!, low[c]!);
        if (parent !== root && low[c]! >= disc[parent]!) cut[parent] = 1;
      }
    }
    if (rootKids > 1) cut[root] = 1;
  }
  return cut;
}
