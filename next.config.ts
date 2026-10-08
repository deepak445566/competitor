import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Tailwind runs through postcss.config.mjs, which works for both Turbopack and webpack builds.
  turbopack: {
    // A stray package-lock.json in the user folder would otherwise be picked as the workspace root.
    root: process.cwd(),
  },
};

export default nextConfig;
