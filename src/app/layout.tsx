import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { APP_NAME, APP_SHORT_NAME, THEME_COLORS } from "@/lib/pwa/manifest";
import "./globals.css";
import { NativeAuthListener } from "./native-auth-listener";
import { ServiceWorker } from "./service-worker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  applicationName: APP_NAME,
  description: "Card spending from bank email alerts",
  // iOS ignores the manifest for these; the icon comes from src/app/apple-icon.png.
  appleWebApp: { capable: true, title: APP_SHORT_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <ServiceWorker />
        <NativeAuthListener />
      </body>
    </html>
  );
}
