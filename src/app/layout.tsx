import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Forge",
    template: "%s · Forge",
  },
  description: "Forge proves whether software is safe to ship.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#080a0d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
