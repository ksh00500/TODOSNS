"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Bell, CalendarDays, Compass, House, MessagesSquare, Trophy, UserRound } from "lucide-react";
import { CloudMark } from "./cloud-mark";
import { useSession } from "./app-providers";
import { OfflineBanner } from "./states";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Challenge } from "@/lib/types";

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
  const notificationCount = useQuery({ queryKey: ["shell-notification-count", user?.id], queryFn: () => apiFetch<{ count: number }>("/me/notifications/unread-count"), enabled: Boolean(user) });
  const directUnread = useQuery({ queryKey: ["direct-unread-count", user?.id], queryFn: () => apiFetch<{ count: number }>("/messages/unread-count"), enabled: Boolean(user) });
  const challengeUnread = useQuery({ queryKey: ["shell-challenge-unread", user?.id], queryFn: () => apiFetch<Challenge[]>("/challenges"), enabled: Boolean(user) });
  const challengeUnreadCount = challengeUnread.data?.reduce((sum, item) => sum + (item.chatUnreadCount ?? 0), 0) ?? 0;
  const focusMode = pathname.startsWith("/todos/import") || /^\/challenges\/[^/]+\/chat$/.test(pathname) || /^\/messages\/[^/]+$/.test(pathname);
  const online = useSyncExternalStore((listener) => { window.addEventListener("online", listener); window.addEventListener("offline", listener); return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); }; }, () => navigator.onLine, () => true);
  return <div className="device-stage"><div className={`mobile-app ${focusMode ? "focus-mode" : ""}`}>
    <a className="skip-to-content" href="#app-content">본문으로 건너뛰기</a>
    {!focusMode && <header className="app-header">
      <Link href="/today" className="cloud-home" aria-label="오늘 화면"><CloudMark compact /></Link>
      <Link href="/today" className="app-brand"><b>뭉실</b>{demo && <small className="demo-chip">체험</small>}</Link>
      <div className="header-actions">{user ? <><Link href="/messages" className="icon-link" aria-label={`대화${directUnread.data?.count ? ` 안 읽은 메시지 ${directUnread.data.count}개` : ""}`}><MessagesSquare />{Boolean(directUnread.data?.count) && <em>{Math.min(99, directUnread.data!.count)}</em>}</Link><Link href="/notifications" className="icon-link" aria-label={`알림${notificationCount.data?.count ? ` ${notificationCount.data.count}개` : ""}`}><Bell />{Boolean(notificationCount.data?.count) && <em>{Math.min(99, notificationCount.data!.count)}</em>}</Link></> : <Link href="/start" className="login-link">로그인</Link>}</div>
    </header>}
    <div className="app-scroll" id="app-content" tabIndex={-1}>{!online && <OfflineBanner />}{children}</div>
    {!focusMode && <nav className="tab-bar" aria-label="주요 메뉴">{tabs.map(({ href, label, icon: Icon }) => { const active = pathname === href || pathname.startsWith(`${href}/`); const badge = label === "챌린지" ? challengeUnreadCount : 0; return <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><span className="tab-icon-wrap"><Icon />{badge > 0 && <em>{Math.min(99, badge)}</em>}</span><span>{label}</span></Link>; })}</nav>}
  </div></div>;
}
