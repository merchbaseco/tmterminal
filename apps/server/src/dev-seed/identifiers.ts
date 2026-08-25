import type { SeededRandom } from "./random.ts";

/** Synthetic identifiers shaped like the real ones, drawn from the seeded RNG. */

const hexAlphabet = "0123456789abcdef";
const uuidVariants = "89ab";

export function buildHexToken(random: SeededRandom, length: number) {
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += hexAlphabet[random.int(0, hexAlphabet.length - 1)];
  }
  return token;
}

/** A version-4-shaped UUID, so seeded rows are indistinguishable from real ones. */
export function buildUuid(random: SeededRandom) {
  const digits = buildHexToken(random, 32).split("");
  digits[12] = "4";
  digits[16] = uuidVariants[random.int(0, uuidVariants.length - 1)] ?? "8";
  const value = digits.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20, 32),
  ].join("-");
}
