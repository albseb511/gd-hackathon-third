import type { Metadata, Viewport } from "next";
import { Geist, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import SwRegister from "@/components/SwRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const display = Cormorant_Garamond({
  variable: "--font-display",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Voicebound",
  description:
    "A live interactive story that listens back — voice-driven branching fiction with real-time generated scenes.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Voicebound",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
