import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Syne } from "next/font/google";
import { connection } from "next/server";
import { env } from "@/lib/env";
import "./globals.css";

const instrument = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-instrument" });
const syne = Syne({ subsets: ["latin"], weight: ["700"], variable: "--font-syne" });

// A function, so APP_URL is read when the server runs, not when the image is built. Without metadataBase,
// link-preview images point at localhost (#724).
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(env.appUrl),
    title: "Lookout",
    description: "A search agent that finds opportunities that fit you, every week.",
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { themeColor: "#1D1A0F", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request so Next can put this request's CSP nonce on its scripts (#14).
  await connection();
  return (
    <html lang="en" className={`${instrument.variable} ${syne.variable}`}>
      <body>{children}</body>
    </html>
  );
}
