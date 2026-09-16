import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CookieMarkets",
  description: "Prediction markets for Cookie Chain."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
