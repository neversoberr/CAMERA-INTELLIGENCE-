import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Assure CCTV Intelligence",
  description: "Central CCTV occupancy monitoring for Assure Clinic"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
