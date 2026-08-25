/** Clock offsets the seed builds its "recently" timestamps from. */

export const minuteMs = 60 * 1000;
export const dayMs = 24 * 60 * minuteMs;

export function shiftDays(from: Date, days: number) {
  return new Date(from.getTime() + days * dayMs);
}

export function shiftMinutes(from: Date, minutes: number) {
  return new Date(from.getTime() + minutes * minuteMs);
}

/** USPTO source dates are calendar days in UTC, matching the `date` columns. */
export function dayLabel(at: Date) {
  return at.toISOString().slice(0, 10);
}
