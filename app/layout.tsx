import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Haggle",
  description: "Tell your buying agent what you need. It finds listings and haggles within your budget.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-slate-50 text-slate-800 font-sans antialiased">{children}</body>
    </html>
  );
}
