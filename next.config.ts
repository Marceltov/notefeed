import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // notefeed doesn't use next/image, so leave out sharp and its LGPL libvips binaries.
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
};

export default nextConfig;
