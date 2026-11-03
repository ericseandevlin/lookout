/**
 * Content Security Policy for pages (#14). Scripts need this request's nonce; Next adds it to its own
 * scripts during server rendering, and 'strict-dynamic' lets those load the rest of the app. No
 * 'unsafe-inline' for scripts. Styles keep 'unsafe-inline' because every component styles itself
 * through React style attributes, which a nonce can't cover; injected style can't run code.
 */
export function pageCsp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** For API responses and files: nothing on them should load or run anything. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** A fresh, unguessable nonce per request (128 bits). */
export function newNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
