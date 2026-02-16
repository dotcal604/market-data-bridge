import type { NextConfig } from "next";

const isStaticExport = process.env.FRONTEND_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : undefined,
  ...(isStaticExport
    ? {}
    : {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: "http://localhost:3000/api/:path*",
            },
          ];
        },
      }),
};

export default nextConfig;
