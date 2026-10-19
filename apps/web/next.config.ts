import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@sci-draw/schemas", "@sci-draw/credits", "@sci-draw/providers"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
