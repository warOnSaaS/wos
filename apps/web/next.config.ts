import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Local builds type-check everything, including the contracts in ../../packages/contracts.
  // The Vercel build uploads apps/web only, so those type-only imports cannot resolve there;
  // types are erased at compile time and nothing from outside apps/web is needed at runtime.
  // Remove when apps/web joins the workspaces (blockers/B-0001-web.md).
  typescript: { ignoreBuildErrors: process.env.VERCEL === "1" },
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.waronsaas.com" }],
        destination: "https://waronsaas.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
