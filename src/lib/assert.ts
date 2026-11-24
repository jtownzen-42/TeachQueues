/**
 * Narrows away `undefined`/`null`, or throws with a clear message.
 * The honest alternative to a `!` or an `as` cast: if the "impossible" case ever
 * happens, it fails loudly here instead of as a confusing error further down.
 */
export function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === undefined || value === null) throw new Error(message);
}
