/**
 * Custom-provider request headers.
 *
 * Two sources, one result:
 *   1. the user's free-form `Name: value` lines (non-secret, stored in the shared settings file), and
 *   2. a generated session header for OpenCode Go, which rejects every request with
 *      `400 MissingSessionID` unless `x-opencode-session` is present. The value only has to be
 *      stable per conversation, so it lives in settings rather than being regenerated per call
 *      (a fresh value would defeat OpenCode's prompt caching).
 *
 * Scoped to `*.opencode.ai` so a vendor-specific header is never sprayed at other endpoints.
 * An explicit user-supplied header of the same name always wins.
 */

const SESSION_HEADER = "x-opencode-session";
const OPENCODE_HOST = "opencode.ai";

/** Parse `Name: value` lines; blanks, comments, and lines without a colon are ignored. */
function parseHeaderLines(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!name) continue;
    headers[name] = value;
  }
  return headers;
}

function isOpenCodeEndpoint(baseURL: string): boolean {
  try {
    const host = new URL(baseURL.trim()).hostname.toLowerCase();
    return host === OPENCODE_HOST || host.endsWith(`.${OPENCODE_HOST}`);
  } catch {
    return false;
  }
}

export function resolveCustomHeaders(input: {
  rawHeaders: string;
  sessionId: string;
  baseURL: string;
}): Record<string, string> {
  const headers = parseHeaderLines(input.rawHeaders);

  const hasSessionHeader = Object.keys(headers).some(
    (name) => name.toLowerCase() === SESSION_HEADER,
  );
  if (!hasSessionHeader && input.sessionId.trim() && isOpenCodeEndpoint(input.baseURL)) {
    headers[SESSION_HEADER] = input.sessionId.trim();
  }

  return headers;
}
