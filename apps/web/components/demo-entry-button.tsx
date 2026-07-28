"use client";

import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { demoAvailable, startDemoMode } from "@/lib/api";

export function DemoEntryButton({ className = "demo-entry" }: { className?: string }) {
  const router = useRouter();
  if (!demoAvailable) return null;
  return <button type="button" className={className} onClick={() => { startDemoMode(); router.push("/today"); }}><Eye /> 로그인 없이 체험하기</button>;
}
