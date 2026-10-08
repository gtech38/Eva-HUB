import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Event Hub Admin", description: "Studio and platform administration" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
