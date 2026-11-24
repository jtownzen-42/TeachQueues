/**
 * Helpers for `catch (e)`. A caught value is `unknown`: anything can be thrown,
 * including strings, null or undefined. Casting it with `(e as Error)` hides that,
 * and `(e as Error).message` throws a second error if `e` is null or undefined.
 */

/** The error's name ("TypeError", "ReconnectRequired"...), or the kind of thing thrown. */
export function errorName(e: unknown): string {
  if (e instanceof Error) return e.name;
  return e === null ? "null" : typeof e;
}

/** The error's message, or a string form of whatever was thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
