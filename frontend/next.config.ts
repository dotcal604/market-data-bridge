import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep standard build - we'll serve .next from Express
  // Static export doesn't support dynamic routes properly
};

export default nextConfig;
