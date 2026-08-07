import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "r2.thesportsdb.com",
        pathname: "/images/media/team/badge/**",
      },
      {
        protocol: "https",
        hostname: "www.thesportsdb.com",
        pathname: "/images/media/team/badge/**",
      },
      // BoardGameGeek hot-list thumbnails. Kept in step with THUMBNAIL_HOSTS
      // in lib/providers/games/bgg-hotness.ts, which drops any other host.
      {
        protocol: "https",
        hostname: "cf.geekdo-images.com",
      },
      {
        protocol: "https",
        hostname: "cf.geekdo-static.com",
      },
    ],
  },
};

export default nextConfig;
