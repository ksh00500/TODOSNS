"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, BookOpen, BriefcaseBusiness, Dumbbell, Heart, Moon, Sparkles, Sprout, Utensils } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/components/app-providers";
import { AuthGate } from "@/components/states";

const options = [{ id: "운동", icon: Dumbbell }, { id: "공부", icon: BookOpen }, { id: "독서", icon: BookOpen }, { id: "식단", icon: Utensils }, { id: "수면", icon: Moon }, { id: "마음 관리", icon: Heart }, { id: "커리어", icon: BriefcaseBusiness }, { id: "일상 관리", icon: Sprout }];

export default function OnboardingPage() {
  const { status, refresh } = useSession(); const router = useRouter(); const [selected, setSelected] = useState<string[]>([]); const mutation = useMutation({ mutationFn: () => apiFetch("/me", { method: "PATCH", body: JSON.stringify({ interests: selected }) }), onSuccess: async () => { await refresh(); router.replace("/today"); } });
  if (status === "guest") return <main className="app-page"><AuthGate /></main>;
  return <main className="app-page onboarding-page"><header><span><Sparkles /> 마지막 한 걸음</span><h1>어떤 실천에<br />관심이 있나요?</h1><p>관심사를 고르면 내게 맞는 루틴을 먼저 보여드려요.<br />나중에 언제든 바꿀 수 있어요.</p></header><div className="interest-picker">{options.map(({ id, icon: Icon }) => <button key={id} className={selected.includes(id) ? "active" : ""} onClick={() => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}><Icon /><span>{id}</span>{selected.includes(id) && <i />}</button>)}</div><button className="button full onboarding-submit" disabled={selected.length < 2 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "저장 중…" : <>선택 완료 ({selected.length}) <ArrowRight /></>}</button><button className="skip-link" onClick={() => router.replace("/today")}>나중에 선택할게요</button></main>;
}
