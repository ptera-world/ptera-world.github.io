/** SHA-1 digest (20 bytes). Synchronous so format parsing can stay synchronous. */
export function sha1(data: Uint8Array): Uint8Array {
  const ml = data.length;
  const padded = new Uint8Array(((ml + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[ml] = 0x80;
  const bits = ml * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((v, i) => ov.setUint32(i * 4, v >>> 0));
  return out;
}

/**
 * Keyless reversible bitmap masking compatible with sgt puzzles' mine-layout obfuscation:
 * split the bytes in half (first half rounded down), mask one half with SHA-1(other half || decimal
 * counter) stream, then the other way round; decoding runs the two steps in reverse order.
 * Pad bits past `bits` are cleared.
 */
export function obfuscateBitmap(bmp: Uint8Array, bits: number, decode: boolean): void {
  const bytes = (bits + 7) >> 3;
  const first = bytes >> 1;
  const second = bytes - first;
  const steps = [
    { seed: [first, second], target: [0, first] },
    { seed: [0, first], target: [first, second] },
  ];
  if (decode) steps.reverse();
  for (const st of steps) {
    const seed = bmp.slice(st.seed[0], st.seed[0]! + st.seed[1]!);
    let digest: Uint8Array = new Uint8Array(0);
    let pos = 20, counter = 0;
    for (let j = 0; j < st.target[1]!; j++) {
      if (pos >= 20) {
        const num = new TextEncoder().encode(String(counter++));
        const buf = new Uint8Array(seed.length + num.length);
        buf.set(seed);
        buf.set(num, seed.length);
        digest = sha1(buf);
        pos = 0;
      }
      const at = st.target[0]! + j;
      bmp[at] = bmp[at]! ^ digest[pos++]!;
    }
    if (bits % 8) bmp[bits >> 3] = bmp[bits >> 3]! & (0xff00 >> (bits % 8)) & 0xff;
  }
}
