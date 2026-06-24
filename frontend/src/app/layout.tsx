import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verihire — verified hiring",
  description: "Verified hiring: AI role-matching, document verification, and candidate outreach",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
