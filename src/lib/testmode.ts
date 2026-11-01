// TEST_MODE enforcement. Every Buffer create-post input MUST pass through draftSafe()
// so that test mode can only ever produce drafts (saveToDraft: true), never publish.

/** Effective test mode: the global TEST_MODE env (default ON) forces drafts for everyone;
 * when it's explicitly "false", each user's own toggle (default ON) decides. */
export function isTestMode(envValue: string | undefined, userTestMode: boolean | null | undefined): boolean {
  const globalOn = (envValue ?? "true").trim().toLowerCase() !== "false";
  return globalOn || userTestMode !== false;
}

export class TestModeViolation extends Error {
  name = "TestModeViolation";
}

/** Returns the input with saveToDraft forced on in test mode; throws if a caller tries
 * to override it to false while test mode is on. */
export function draftSafe<T extends object>(input: T & { saveToDraft?: boolean }, testMode: boolean): T & { saveToDraft?: boolean } {
  if (!testMode) return input;
  if (input.saveToDraft === false) throw new TestModeViolation("Test mode is on: posts can only be saved as Buffer drafts.");
  return { ...input, saveToDraft: true };
}
