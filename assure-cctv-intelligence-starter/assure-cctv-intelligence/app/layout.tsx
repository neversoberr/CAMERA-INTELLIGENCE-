import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Framewatch · Occupancy Monitor",
  description: "Check which camera views are occupied or empty, privately in your browser."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
