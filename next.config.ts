import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pino stays a plain Node require (it is on Next's own list too), so the standalone build traces it into node_modules.
  serverExternalPackages: ["pino"],
  // proxy.ts handles trailing slashes itself: POST /<feed>/ stores the note, everything else gets a 308.
  skipTrailingSlashRedirect: true,
  // /r/<readId>/<name>.<ext> is a file of the feed; a note id has no dot, so notes stay on their page; feed.xml is the RSS route.
  rewrites: async () => [{ source: "/r/:readId/:file((?!feed\\.xml$)[^/]+\\.[a-z0-9]+)", destination: "/r/:readId/files/:file" }],
  // The OAuth login hands a code to whatever host the client registered: no framing it (clickjacking a
  // password manager's autofill and the "Allow" click).
  headers: async () => [{ source: "/oauth/authorize", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] }],
  // notefeed doesn't use next/image, so leave out sharp and its LGPL libvips binaries.
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
};

export default nextConfig;
