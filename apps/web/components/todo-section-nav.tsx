"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Layers3, Tags } from "lucide-react";

const items = [
  { href: "/todos", label: "일정", icon: CalendarDays },
  { href: "/todos/routines", label: "그룹", icon: Layers3 },
  { href: "/todos/categories", label: "카테고리", icon: Tags },
];

export function TodoSectionNav() {
  const pathname = usePathname();
  return <nav className="todo-section-nav" aria-label="TODO 관리 메뉴">{items.map(({ href, label, icon: Icon }) => { const active = pathname === href; return <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={href}><Icon aria-hidden /><span>{label}</span></Link>; })}</nav>;
}
