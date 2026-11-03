import type { NextConfig } from "next";
import { API_CSP } from "./src/lib/csp";

const isProd = process.env.NODE_ENV === "production";

// Pages get a per-request nonce CSP from src/proxy.ts (#14). API responses get one that allows nothing.

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["unpdf", "mammoth", "playwright-core"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
      // Firefox only offers to install an add-on served with this type; otherwise it downloads a file (#172).
      { source: "/ext/:file*.xpi", headers: [{ key: "Content-Type", value: "application/x-xpinstall" }] },
    ];
  },
};

export default nextConfig;
