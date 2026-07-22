import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "뭉실 — 오늘의 작은 실천",
  description: "TODO를 완료하고, 좋은 습관을 나누고, 함께 실천하는 건강한 루틴 SNS",
  applicationName: "뭉실",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "뭉실", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    title: "뭉실 — 오늘의 작은 실천",
    description: "완료하고, 나누고, 함께 둥실 떠오르는 TODO SNS",
    images: [{ url: "/mungsil-og.png", width: 1792, height: 922, alt: "하늘로 떠오르는 뭉실 구름" }],
  },
  twitter: { card: "summary_large_image", images: ["/mungsil-og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f6fbff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
