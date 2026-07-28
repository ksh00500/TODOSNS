import type { NextConfig } from "next";
import path from "node:path";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { optimizePackageImports: ["lucide-react"] },
  turbopack: { root: path.resolve(__dirname, "../..") },
};

export default nextConfig;
