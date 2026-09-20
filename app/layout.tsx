import type { Metadata } from "next";
import "./globals.css";
import { NavigationFeedback } from "@/components/navigation-feedback";

export const metadata: Metadata = {
  title: "CookieMarkets",
  description: "Prediction markets for Cookie Chain."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<NavigationFeedback /></body>
    </html>
  );
}
