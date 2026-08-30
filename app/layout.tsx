import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIDAS — Personal Financial Command Center",
  description: "Planifica, registra y controla tus finanzas personales con inteligencia.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
