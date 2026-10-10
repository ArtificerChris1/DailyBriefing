import type { MetadataRoute } from "next";

/** Matches `basePath`, so an install from a GitHub Pages subpath still works. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Daily Briefing",
    short_name: "Daily Briefing",
    description:
      "A private daily briefing across work, family, weather, sports, and news.",
    start_url: `${BASE_PATH}/`,
    display: "standalone",
    background_color: "#f4f3ee",
    theme_color: "#182228",
    icons: [
      {
        src: `${BASE_PATH}/icon.png`,
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
