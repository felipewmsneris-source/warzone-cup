import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Warzone Cup",
  description: "Classificação, reports e transmissão do campeonato semanal de Warzone.",
};
export const viewport: Viewport = { themeColor: "#0d141b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700;800&family=Saira:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
