import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "@react-pdf/renderer", "mammoth"],
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**", "./seed/files/**", "./lib/export/fonts/**", "./drizzle/**"],
    "/**": ["./drizzle/**"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Everything except the document preview stream may never be framed.
      { source: "/((?!api/documents/\\d+/file).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      {
        source: "/api/documents/:id/file",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
