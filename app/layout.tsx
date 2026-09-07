import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./chat.css";
import ChatOverlay from "./ChatOverlay";

export const metadata: Metadata = {
  title: "Undercover",
  description: "Undercover entre potes — rooms privées, indices et votes.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0f12",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        {children}
        <ChatOverlay />
      </body>
    </html>
  );
}
