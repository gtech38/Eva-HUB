import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// Every service reads the single root .env.
loadEnv({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  transpilePackages: ["@hub/db", "@hub/shared"],
  serverExternalPackages: ["@prisma/client", "nodemailer", "@aws-sdk/client-s3"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  typescript: { ignoreBuildErrors: false },
  webpack(config) {
    // Biometric consent texts (legal/consent/**) are bundled as strings by `?raw` imports in
    // @hub/shared/consent; vitest handles `?raw` natively. Scoped to exactly `?raw` under legal/.
    config.module.rules.push({ resourceQuery: /^\?raw$/, include: path.resolve(__dirname, "../../legal"), type: "asset/source" });
    return config;
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
