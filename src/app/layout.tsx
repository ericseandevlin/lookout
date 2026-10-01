import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Syne } from "next/font/google";
import "./globals.css";

const instrument = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-instrument" });
const syne = Syne({ subsets: ["latin"], weight: ["700"], variable: "--font-syne" });

export const metadata: Metadata = {
  title: "Lookout",
  description: "A search agent that finds opportunities that fit you, every week.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#1D1A0F", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${syne.variable}`}>
      <body>{children}</body>
    </html>
  );
}
