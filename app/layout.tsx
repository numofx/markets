import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import Providers from "./providers";

const siteUrl = new URL("https://numofx.com");

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export async function generateMetadata(): Promise<Metadata> {
  // Keep this in one place so link previews (Telegram, etc.) stay consistent.
  // We still fetch translations so other locales can override if/when they exist.
  const t = await getTranslations("HomePage");

  const title = "Numo";
  const description = t("description");
  const openGraphDescription = "Borrow stablecoins at fixed rates.";

  return {
    alternates: {
      canonical: siteUrl,
    },
    description,
    icons: {
      apple: [{ sizes: "180x180", type: "image/png", url: "/apple-touch-icon.png" }],
      icon: [
        { sizes: "32x32", type: "image/png", url: "/favicon-32x32.png" },
        { sizes: "16x16", type: "image/png", url: "/favicon-16x16.png" },
        { url: "/favicon.ico" },
      ],
    },
    manifest: "/site.webmanifest",
    // Ensure relative OpenGraph/Twitter image URLs resolve to absolute URLs.
    metadataBase: siteUrl,
    openGraph: {
      description: openGraphDescription,
      images: [
        {
          alt: "Numo",
          height: 630,
          url: "/og-image.png",
          width: 1200,
        },
      ],
      siteName: "Numo",
      title,
      type: "website",
      url: siteUrl,
    },
    title,
    twitter: {
      card: "summary_large_image",
      description: openGraphDescription,
      images: ["/og-image.png"],
      title,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
