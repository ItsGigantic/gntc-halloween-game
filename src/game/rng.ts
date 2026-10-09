/** Small seeded PRNG (mulberry32) so showcase runs are repeatable. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Weighted pick from [item, weight] pairs. */
  weighted<T>(arr: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of arr) total += w;
    let r = this.next() * total;
    for (const [v, w] of arr) {
      r -= w;
      if (r <= 0) return v;
    }
    return arr[arr.length - 1][0];
  }
}
