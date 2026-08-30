import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Pulse",
  description: "Private Codex usage intelligence with an opt-in community leaderboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
