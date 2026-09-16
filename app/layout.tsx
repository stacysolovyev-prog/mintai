import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tutor mint",
  description:
    "Get unstuck without being handed the answer. Scan a problem, talk it through, and study what you got wrong.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "tutor mint" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <head>
        {/* The typeface is self-hosted from /public/fonts — see globals.css.
            Preloading the latin subset keeps the first paint on-brand. */}
        <link
          rel="preload"
          href="/fonts/plus-jakarta-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
