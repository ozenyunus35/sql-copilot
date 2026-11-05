import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Quarry · Ask your data in plain language",
  description: "Quarry turns questions in English or Turkish into SQL you can read, run, chart and export. A rule-based text-to-SQL engine and SQLite, both running in your browser. Demo data is synthetic.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d0f" },
  ],
};

// Applies the saved theme before first paint to avoid a flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("quarry:theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans text-[13px] leading-5">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
