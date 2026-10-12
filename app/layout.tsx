import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { APPEARANCE_SCRIPT } from "@/lib/preferences";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daily Briefing",
  description:
    "A private daily briefing across work, family, weather, sports, and news.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout extend under the iPhone notch; globals.css pads with
  // the safe-area insets so nothing is hidden behind it.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d1214" },
    { media: "(prefers-color-scheme: light)", color: "#f3f4ee" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint; see lib/preferences.ts. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
