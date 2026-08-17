import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Daily Briefing",
    short_name: "Daily Briefing",
    description:
      "A private daily briefing across work, family, weather, sports, and news.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f3ee",
    theme_color: "#182228",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
