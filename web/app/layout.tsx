import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Pulse",
  description: "Private usage intelligence for Codex and connected providers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
