/**
 * Small deterministic generator so a seed run is varied but reproducible: the
 * same seed string always produces the same marks and the same source-file
 * history, while a new seed produces a different plausible week. Lehmer's
 * multiplicative generator, because it needs no bitwise arithmetic and every
 * intermediate stays inside a double.
 */

const modulus = 2_147_483_647;
const multiplier = 48_271;
const hashMultiplier = 31;

export interface SeededRandom {
  /** Uniform float in [min, max). */
  between: (min: number, max: number) => number;
  /** True with the given probability. */
  chance: (probability: number) => boolean;
  /** Uniform integer in [min, max]. */
  int: (min: number, max: number) => number;
  /** Uniform float in [0, 1). */
  next: () => number;
  /** Uniform element of a non-empty list. */
  pick: <T>(values: readonly T[]) => T;
  /** A copy of the list in a deterministic shuffled order. */
  shuffle: <T>(values: readonly T[]) => T[];
  /** The element a weight-ranked list would return, biased towards the front. */
  weighted: <T>(values: readonly T[], exponent: number) => T;
}

export function createSeededRandom(seed: string): SeededRandom {
  let state = hashSeed(seed);

  const next = () => {
    state = (state * multiplier) % modulus;
    return (state - 1) / (modulus - 1);
  };

  const between = (min: number, max: number) => min + next() * (max - min);

  const int = (min: number, max: number) => Math.floor(between(min, max + 1));

  const pick = <T>(values: readonly T[]): T => {
    const value = values[int(0, values.length - 1)];
    if (value === undefined) {
      throw new Error("Cannot pick from an empty list.");
    }
    return value;
  };

  const weighted = <T>(values: readonly T[], exponent: number): T => {
    const index = Math.floor(next() ** exponent * values.length);
    const value = values[Math.min(index, values.length - 1)];
    if (value === undefined) {
      throw new Error("Cannot pick from an empty list.");
    }
    return value;
  };

  const shuffle = <T>(values: readonly T[]) => {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = int(0, index);
      const current = shuffled[index];
      const swap = shuffled[swapIndex];
      if (current !== undefined && swap !== undefined) {
        shuffled[index] = swap;
        shuffled[swapIndex] = current;
      }
    }
    return shuffled;
  };

  return {
    between,
    chance: (probability: number) => next() < probability,
    int,
    next,
    pick,
    shuffle,
    weighted,
  };
}

/** Polynomial hash into the generator's non-zero state range. */
function hashSeed(seed: string) {
  let hash = 7;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * hashMultiplier + seed.charCodeAt(index)) % modulus;
  }

  return hash === 0 ? 1 : hash;
}
