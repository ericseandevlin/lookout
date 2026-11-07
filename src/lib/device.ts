/** "Chrome on Mac" from a user agent string. Good enough to recognize your own devices. */
export function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  // iOS browsers carry their own token plus Safari/, and Opera and Edge carry Chrome/, so check those first.
  const browser = /Edg(iOS|A)?\//.test(ua) ? "Edge" : /OPR\/|OPiOS\//.test(ua) ? "Opera" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
