import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
