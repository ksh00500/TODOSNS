"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Bell, CalendarDays, Compass, House, Trophy, UserRound } from "lucide-react";
import { CloudMark } from "./cloud-mark";
import { useSession } from "./app-providers";
import { OfflineBanner } from "./states";

const tabs = [
  { href: "/today", label: "오늘", icon: House },
  { href: "/explore", label: "탐색", icon: Compass },
  { href: "/todos", label: "TODO", icon: CalendarDays },
  { href: "/challenges", label: "챌린지", icon: Trophy },
  { href: "/me", label: "마이", icon: UserRound },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, demo } = useSession();
  const focusMode = pathname.startsWith("/todos/import");
  const online = useSyncExternalStore((listener) => { window.addEventListener("online", listener); window.addEventListener("offline", listener); return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); }; }, () => navigator.onLine, () => true);
  return <div className="device-stage"><div className={`mobile-app ${focusMode ? "focus-mode" : ""}`}>
    {!focusMode && <header className="app-header">
      <Link href="/today" className="cloud-home" aria-label="오늘 화면"><CloudMark compact /></Link>
      <Link href="/today" className="app-brand"><b>뭉실</b>{demo && <small className="demo-chip">체험</small>}</Link>
      <div className="header-actions">{user ? <Link href="/notifications" className="icon-link" aria-label="알림"><Bell /></Link> : <Link href="/start" className="login-link">로그인</Link>}</div>
    </header>}
    <div className="app-scroll" id="app-scroll">{!online && <OfflineBanner />}{children}</div>
    {!focusMode && <nav className="tab-bar" aria-label="주요 메뉴">{tabs.map(({ href, label, icon: Icon }) => { const active = pathname === href || pathname.startsWith(`${href}/`); return <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon /><span>{label}</span></Link>; })}</nav>}
  </div></div>;
}
