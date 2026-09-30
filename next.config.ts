import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // proxy.ts handles trailing slashes itself: POST /<feed>/ stores the note, everything else gets a 308.
  skipTrailingSlashRedirect: true,
  // notefeed doesn't use next/image, so leave out sharp and its LGPL libvips binaries.
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
};

export default nextConfig;
