import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIDAS — Hub de control de gastos",
  description: "Tu hub de control de gastos: organiza presupuestos, ingresos, gastos y deudas en un solo lugar.",
  applicationName: "MIDAS",
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
