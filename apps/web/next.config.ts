import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@sci-draw/schemas", "@sci-draw/credits", "@sci-draw/providers"],
  serverExternalPackages: ["sharp", "potrace", "pptxgenjs", "pdf-lib", "jimp", "@e2b/code-interpreter", "e2b"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
