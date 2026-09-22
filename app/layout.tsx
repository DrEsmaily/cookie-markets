import type { Metadata } from "next";
import "./globals.css";
import { NavigationFeedback } from "@/components/navigation-feedback";

export const metadata: Metadata = {
  metadataBase: new URL("https://cookie.markets"),
  title: "CookieMarkets",
  description: "Trade transparent BTC and ETH prediction markets with real COOK settlement on Cookie Chain.",
  openGraph: {
    title: "CookieMarkets",
    description: "Predict crypto trends, provide liquidity, and settle transparently on Cookie Chain.",
    url: "https://cookie.markets",
    siteName: "CookieMarkets",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "CookieMarkets",
    description: "Predict crypto trends and settle transparently on Cookie Chain."
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<NavigationFeedback /></body>
    </html>
  );
}
