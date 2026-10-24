import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const plexSans = localFont({
  variable: "--font-plex-sans",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

const plexMono = localFont({
  variable: "--font-plex-mono",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

const plexSerif = localFont({
  variable: "--font-plex-serif",
  display: "swap",
  src: [
    { path: "./fonts/ibm-plex-serif-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/ibm-plex-serif-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "TM Summary Drafter",
  description: "Drafts AML transaction-monitoring investigation summaries for analyst review.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${plexSerif.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
