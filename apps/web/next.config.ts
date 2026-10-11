import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The UI is a client-side app over the local API; no server data caching needed.
  transpilePackages: ["@reel/shared"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
