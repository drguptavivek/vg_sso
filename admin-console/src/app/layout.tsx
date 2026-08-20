import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin Console",
  description: "HR user management and delegated client-admin group management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
