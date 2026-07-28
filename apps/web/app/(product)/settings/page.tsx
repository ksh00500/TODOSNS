"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, FileText, LogOut, Shield, Trash2 } from "lucide-react";
import { apiFetch, clearSession } from "@/lib/api";
import { useSession } from "@/components/app-providers";
import { AuthGate } from "@/components/states";
import { Sheet } from "@/components/sheet";

export default function SettingsPage() {
  const { status, refresh } = useSession(); const router = useRouter(); const [deleting, setDeleting] = useState(false); const [busy, setBusy] = useState(false);
  if (status === "guest") return <main className="app-page"><AuthGate /></main>;
  const logout = async () => { setBusy(true); try { await apiFetch("/auth/logout", { method: "POST" }); } finally { clearSession(); await refresh(); router.replace("/"); } };
  const remove = async () => { setBusy(true); try { await apiFetch("/auth/delete-account", { method: "POST" }); clearSession(); await refresh(); router.replace("/"); } finally { setBusy(false); } };
  return <main className="app-page settings-page"><header className="simple-header"><h1>설정</h1></header><div className="settings-list"><Link href="/privacy"><span><Shield /></span><div><b>개인정보 처리방침</b><small>내 정보가 어떻게 보호되는지 확인해요</small></div><ChevronRight /></Link><Link href="/terms"><span><FileText /></span><div><b>이용약관</b><small>서비스 이용 기준을 확인해요</small></div><ChevronRight /></Link><button onClick={logout} disabled={busy}><span><LogOut /></span><div><b>로그아웃</b><small>이 기기에서 계정 연결을 종료해요</small></div><ChevronRight /></button><button className="danger" onClick={() => setDeleting(true)}><span><Trash2 /></span><div><b>계정 탈퇴</b><small>요청 후 7일 안에 정보가 삭제돼요</small></div><ChevronRight /></button></div>{deleting && <Sheet title="정말 탈퇴할까요?" onClose={() => setDeleting(false)}><div className="delete-confirm"><Trash2 /><p>TODO, 공유 기록과 뭉실 등급을 복구할 수 없어요.</p><button className="button full" onClick={remove} disabled={busy}>{busy ? "처리 중…" : "계정 탈퇴 요청"}</button><button className="skip-link" onClick={() => setDeleting(false)}>계속 뭉실 사용하기</button></div></Sheet>}</main>;
}
