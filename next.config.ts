import type { NextConfig } from "next";

// Set by the Pages workflow to "/<repo>"; empty for local development.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A plain static site: `next build` writes HTML and JSON to `out/`, and
  // every provider runs then rather than on a server.
  output: "export",
  basePath,
  env: {
    // Identifies this build to the page, which compares it with /build.json
    // to notice when a newer one has been deployed.
    NEXT_PUBLIC_BUILD_ID: String(Date.now()),
  },
  experimental: {
    // Render the 22 day files one at a time in one process, so each provider's
    // in-memory cache is shared between them. In parallel, every day fetched
    // every feed itself and Open-Meteo refused the burst.
    cpus: 1,
    staticGenerationMaxConcurrency: 1,
  },
  images: {
    // A static host has no image optimizer, so images load straight from
    // their source.
    unoptimized: true,
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
      // TMDB posters. Kept in step with POSTER_BASE in
      // lib/providers/releases/tmdb-screen.ts.
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
      // Comic Vine issue covers. Their CDN has moved between GameSpot and
      // CBS Interactive hosts over the years and the API returns whichever is
      // current, so both are allowed; kept in step with coverUrl() in
      // lib/providers/releases/comic-vine.ts.
      {
        protocol: "https",
        hostname: "comicvine.gamespot.com",
      },
      {
        protocol: "https",
        hostname: "**.gamespot.com",
      },
      {
        protocol: "https",
        hostname: "**.cbsistatic.com",
      },
    ],
  },
};

export default nextConfig;
