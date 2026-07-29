import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = (
    requestHeaders.get("x-forwarded-host")
    || requestHeaders.get("host")
    || "localhost:3000"
  ).split(",")[0].trim();
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: "Norte Sul Vendas",
    description: "Força de vendas integrada ao Sankhya",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "NS Vendas",
    },
    openGraph: {
      title: "Norte Sul Vendas",
      description: "Pedidos integrados ao Sankhya",
      type: "website",
      images: [{ url: "/og.png", width: 1748, height: 910, alt: "Norte Sul Vendas" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Norte Sul Vendas",
      description: "Pedidos integrados ao Sankhya",
      images: ["/og.png"],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#087a4d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/app-icon-192.png" sizes="192x192" type="image/png" />
        <link rel="icon" href="/app-icon-512.png" sizes="512x512" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
      </head>
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
