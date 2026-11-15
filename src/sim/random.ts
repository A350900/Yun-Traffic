// Simulated traffic: deterministic randomness. The same inputs always give the
// same numbers, so every visitor sees the same simulated sky and it doesn't
// change on reload.

/** 32-bit string hash (FNV-1a). */
export function hash(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Small fast seeded PRNG (mulberry32): returns numbers in [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Poisson-distributed count with mean `lambda` (Knuth; fine for small lambda). */
export function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian(rand)))
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rand()
  } while (p > L)
  return k - 1
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Pick an index from relative weights. */
export function pickWeighted(weights: readonly number[], rand: () => number): number {
  let total = 0
  for (const w of weights) total += w
  let r = rand() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}
