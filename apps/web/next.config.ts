import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// Every service reads the single root .env. (apps/web/.env is also a symlink to it,
// so Next's own loader picks it up in worker processes.)
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  transpilePackages: ["@hub/db", "@hub/shared"],
  serverExternalPackages: ["@prisma/client", "nodemailer", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    // Nothing on an event site is public: never let a shared cache keep a response.
    // Hashed static chunks are safe to cache; everything else is per-viewer.
    return [
      {
        source: "/:path((?!_next/static|_next/image).*)",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
