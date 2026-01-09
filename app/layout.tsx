import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("HomePage");

  return {
    description: t("description"),
    icons: {
      apple: [{ sizes: "180x180", type: "image/png", url: "/apple-touch-icon.png" }],
      icon: [
        { sizes: "32x32", type: "image/png", url: "/favicon-32x32.png" },
        { sizes: "16x16", type: "image/png", url: "/favicon-16x16.png" },
        { url: "/favicon.ico" },
      ],
    },
    manifest: "/site.webmanifest",
    title: t("title"),
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
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
