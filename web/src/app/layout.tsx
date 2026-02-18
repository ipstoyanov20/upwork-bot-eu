import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EU Proposals - Realtime Viewer",
  description: "Realtime viewer for /eu_proposals in Firebase Realtime Database.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
