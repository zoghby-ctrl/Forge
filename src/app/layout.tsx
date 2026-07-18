import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forge",
  description: "Forge proves whether software is safe to ship.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
