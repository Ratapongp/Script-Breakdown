import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Screenplay Report Generator",
  description:
    "Upload a screenplay PDF and generate clean Scene, Character, Location, and Extra Cast reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sarabun:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="font-sans bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
