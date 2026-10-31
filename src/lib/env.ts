// Server-only environment access. Values are trimmed because Buffer compares
// redirect URIs character for character (a stray newline breaks the flow).
import "server-only";

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const DEFAULT_SCOPES = "account:read posts:read posts:write offline_access";

export const env = {
  get clientId() { return req("BUFFER_CLIENT_ID"); },
  get clientSecret() { return req("BUFFER_CLIENT_SECRET"); },
  get redirectUri() { return req("BUFFER_REDIRECT_URI"); },
  get sessionSecret() { return req("SESSION_SECRET"); },
  get tokenEncKey() { return req("TOKEN_ENC_KEY"); },
  get databaseUrl() { return req("DATABASE_URL"); },
  get scopes() { return process.env.BUFFER_SCOPES?.trim() || DEFAULT_SCOPES; },
  /** Test mode = every Buffer post is created with saveToDraft: true. Defaults ON. */
  get testMode() { return (process.env.TEST_MODE ?? "true").trim().toLowerCase() !== "false"; },
};

let loggedRedirect = false;
/** Buffer's docs recommend logging the redirect URI once to catch mismatches. */
export function logRedirectUriOnce() {
  if (loggedRedirect) return;
  loggedRedirect = true;
  console.info(`[teachqueue] BUFFER_REDIRECT_URI=${env.redirectUri}`);
}
