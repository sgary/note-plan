/**
 * True when a custom endpoint would send the API key over plain http to a non-loopback host.
 * Loopback is exempt: a local Ollama/vLLM endpoint is http by nature and never leaves the
 * machine. Used only to warn in Settings — never to block, since only the user knows their
 * network.
 */
export function isInsecureEndpoint(url: string): boolean {
  const trimmed = url.trim();
  if (!/^http:\/\//i.test(trimmed)) return false;

  let host: string;
  try {
    host = new URL(trimmed).hostname;
  } catch {
    // Not parseable — the field is still being typed; nothing to warn about yet.
    return false;
  }

  return !(host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}
