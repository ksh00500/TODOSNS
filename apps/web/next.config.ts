import type { NextConfig } from "next";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Run build checks in worker threads so restricted Windows runners can complete production builds.
  experimental: { optimizePackageImports: ["lucide-react"], workerThreads: true },
  turbopack: { root: path.resolve(__dirname, "../..") },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
