/**
 * AI HTTP fetch — an injectable host seam (SEAM pattern, like key-resolver).
 *
 * Why: user-supplied endpoints (a custom OpenAI-compatible base URL) are not enumerable, so
 * they cannot go in the desktop app's CSP `connect-src` allowlist. The Tauri host therefore
 * injects the `@tauri-apps/plugin-http` fetch (request runs in Rust/reqwest, bypassing CSP and
 * CORS). Every other host (Node server, browser fixture) keeps the global fetch.
 */

export type AIFetchResolver = () => typeof fetch;

// Lazy: `fetch` is resolved at call time so tests and hosts can replace it freely.
const defaultResolver: AIFetchResolver = () => fetch;

let resolver: AIFetchResolver = defaultResolver;

export function setAIFetchResolver(r: AIFetchResolver): void {
  resolver = r;
}

export function resetAIFetchResolver(): void {
  resolver = defaultResolver;
}

export function getAIFetchResolver(): AIFetchResolver {
  return resolver;
}
