import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BackgroundCanvas from "@/components/background-canvas";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Do the deads dance",
  description: "Ask a science or engineering pioneer, in their own voice.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <BackgroundCanvas />
        <div className="relative z-10 flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
