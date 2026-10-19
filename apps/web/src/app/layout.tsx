import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "sci-draw",
  description: "Prompt a scientific figure, then keep the image against a credit balance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl px-5 py-10">{children}</main>
      </body>
    </html>
  );
}
