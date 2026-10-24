/** Deterministic PRNG (mulberry32) so the seed data is identical on every run. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)],
    /** Amount with cents that is never a multiple of 1,000. */
    nonRound: (min: number, max: number) => {
      for (;;) {
        const v = Math.round((min + next() * (max - min)) * 100) / 100;
        if (Math.round(v * 100) % 100000 !== 0) return v;
      }
    },
    /** Multiple of 1,000 in [min, max]. */
    round: (min: number, max: number) => Math.round((min + next() * (max - min)) / 1000) * 1000,
  };
}
export type Rng = ReturnType<typeof rng>;

export function isoDay(start: string, offset: number) {
  const d = new Date(start + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** `n` sorted day offsets spread over [from, to] inclusive. */
export function spreadDays(r: Rng, n: number, from: number, to: number) {
  return Array.from({ length: n }, () => r.int(from, to)).sort((a, b) => a - b);
}
