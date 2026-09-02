"use client";

import { FormEvent, useState } from "react";
import { Camera, Check, Coins, Plus, ShieldCheck, Trash2, Trophy } from "lucide-react";
import type { Challenge } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { DatePicker } from "./todo-form-controls";
import { Sheet } from "./sheet";

const dateInput = (offset: number) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const dayKey = (value?: string) => value ? new Date(value).toISOString().slice(0, 10) : "";
const verificationOptions = [
  { value: "CHECK", label: "간편 체크", body: "누르면 바로 인증돼요. 사진은 기록용으로 선택할 수 있어요.", icon: Check },
  { value: "PEER_PHOTO", label: "참여자 사진 인증", body: "같은 챌린지 참여자들이 익명으로 기준을 확인해요.", icon: Camera },
] as const;
const defaultCriteria = ["사진만 보고 오늘 실천을 완료했다고 판단할 수 있나요?", "사진이 챌린지 주제와 맞나요?", "재사용하거나 조작한 흔적 없이 자연스러운 인증인가요?"];

export function ChallengeComposer({ onClose, onSaved, kind = "COMMUNITY", challenge }: { onClose: () => void; onSaved: () => void; kind?: "OFFICIAL" | "COMMUNITY"; challenge?: Challenge }) {
  const editing = Boolean(challenge);
  const [title, setTitle] = useState(challenge?.title ?? "");
  const [description, setDescription] = useState(challenge?.description ?? "");
  const [startsAt, setStartsAt] = useState(dayKey(challenge?.startsAt) || dateInput(0));
  const [endsAt, setEndsAt] = useState(dayKey(challenge?.endsAt) || dateInput(20));
  const [verificationMode, setVerificationMode] = useState<Challenge["verificationMode"]>(challenge?.verificationMode ?? "CHECK");
  const [verificationCriteria, setVerificationCriteria] = useState(challenge?.verificationCriteria?.length ? challenge.verificationCriteria : defaultCriteria);
  const [completionThreshold, setCompletionThreshold] = useState(challenge?.completionThreshold ?? 80);
  const [rewardLabel, setRewardLabel] = useState(challenge?.rewardLabel ?? "");
  const [rewardTerms, setRewardTerms] = useState(challenge?.rewardTerms ?? "");
  const [firstPlaceTitle, setFirstPlaceTitle] = useState(challenge?.firstPlaceTitle ?? "");
  const [secondPlaceTitle, setSecondPlaceTitle] = useState(challenge?.secondPlaceTitle ?? "");
  const [thirdPlaceTitle, setThirdPlaceTitle] = useState(challenge?.thirdPlaceTitle ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiFetch(editing ? `/challenges/${challenge!.id}` : "/challenges", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          title: title.trim(), description: description.trim(), ...(editing ? {} : { kind }), verificationMode,
          startsAt: new Date(`${startsAt}T00:00:00`).toISOString(), endsAt: new Date(`${endsAt}T23:59:59`).toISOString(), completionThreshold,
          verificationCriteria: verificationMode === "PEER_PHOTO" ? verificationCriteria.map((item) => item.trim()).filter(Boolean) : undefined,
          rewardLabel: rewardLabel.trim() || null, rewardTerms: rewardTerms.trim() || null,
          firstPlaceTitle: firstPlaceTitle.trim() || null, secondPlaceTitle: secondPlaceTitle.trim() || null, thirdPlaceTitle: thirdPlaceTitle.trim() || null,
        }),
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "챌린지를 저장하지 못했어요.");
    } finally { setBusy(false); }
  }

  const activeKind = challenge?.kind ?? kind;
  const rewardNeedsPhoto = activeKind === "OFFICIAL" && Boolean(rewardLabel.trim()) && verificationMode === "CHECK";
  return <Sheet title={editing ? "챌린지 편집" : activeKind === "OFFICIAL" ? "공식 챌린지 만들기" : "커뮤니티 챌린지 만들기"} onClose={onClose}>
    <form className="composer-form challenge-form" onSubmit={submit}>
      {!editing && activeKind === "COMMUNITY" && <div className="point-cost-note"><Coins aria-hidden /><div><b>500 포인트</b><small>개설 즉시 차감되며 취소해도 반환되지 않아요.</small></div></div>}
      {activeKind === "OFFICIAL" && <div className="official-note"><ShieldCheck aria-hidden /><div><b>공식 챌린지</b><small>운영자는 기준과 보상을 관리하고, 사진 판정은 참여자 투표로 자동 처리해요.</small></div></div>}
      <label className="field"><span>챌린지 이름</span><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={120} required placeholder="예: 잠들기 전 책 10쪽" /></label>
      <label className="field"><span>함께할 약속</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={1000} required placeholder="누구나 이해할 수 있도록 실천 방법을 적어주세요." /></label>
      <div className="challenge-date-grid"><DatePicker label="시작일" value={startsAt} onChange={(value) => { setStartsAt(value); if (endsAt < value) setEndsAt(value); }} /><DatePicker label="종료일" value={endsAt} min={startsAt} onChange={setEndsAt} /></div>
      <fieldset className="verification-picker"><legend>인증 방식</legend><div>{verificationOptions.map((item) => { const Icon = item.icon; return <button type="button" key={item.value} aria-pressed={verificationMode === item.value} className={verificationMode === item.value ? "selected" : ""} onClick={() => setVerificationMode(item.value)}><Icon aria-hidden /><span><b>{item.label}</b><small>{item.body}</small></span></button>; })}</div></fieldset>
      {verificationMode === "PEER_PHOTO" && <fieldset className="verification-criteria"><legend>사진 확인 기준</legend><p>참여자는 사진과 아래 질문만 보고 예·아니요·잘 모르겠어요로 답해요.</p>{verificationCriteria.map((criterion, index) => <div key={index}><label className="field"><span>기준 {index + 1}</span><input value={criterion} minLength={5} maxLength={120} required onChange={(event) => setVerificationCriteria((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label>{verificationCriteria.length > 1 && <button type="button" className="icon-button danger" aria-label={`기준 ${index + 1} 삭제`} onClick={() => setVerificationCriteria((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></button>}</div>)}{verificationCriteria.length < 5 && <button type="button" className="secondary-button full" onClick={() => setVerificationCriteria((current) => [...current, ""])}><Plus /> 확인 기준 추가</button>}<small>최소 참여자 8명 · 5명 중 4명 동의 시 통과 · 2명 재요청 시 다시 올리기</small></fieldset>}
      <fieldset className="threshold-picker"><legend>완주 기준</legend><p>기간 중 승인된 인증 비율이 기준 이상이면 완주예요.</p><div>{[60,70,80,90,100].map((value) => <button type="button" key={value} aria-pressed={completionThreshold === value} className={completionThreshold === value ? "selected" : ""} onClick={() => setCompletionThreshold(value)}>{value}%</button>)}</div></fieldset>
      {activeKind === "COMMUNITY" ? <fieldset className="rank-title-fields"><legend><Trophy aria-hidden /> 순위 칭호</legend><p>완주 기준을 달성한 상위 3명에게 자동 지급해요.</p><label className="field"><span>1위 칭호</span><input value={firstPlaceTitle} onChange={(event) => setFirstPlaceTitle(event.target.value)} maxLength={120} placeholder="예: 새벽 독서 구름" /></label><label className="field"><span>2위 칭호</span><input value={secondPlaceTitle} onChange={(event) => setSecondPlaceTitle(event.target.value)} maxLength={120} placeholder="예: 꾸준한 책 구름" /></label><label className="field"><span>3위 칭호</span><input value={thirdPlaceTitle} onChange={(event) => setThirdPlaceTitle(event.target.value)} maxLength={120} placeholder="예: 오늘도 독서 구름" /></label></fieldset> : <><label className="field"><span>보상 이름</span><input value={rewardLabel} onChange={(event) => setRewardLabel(event.target.value)} maxLength={120} placeholder="예: 브랜드 리워드 키트" /></label>{rewardLabel.trim() && verificationMode === "CHECK" && <p className="field-help warning">보상이 있는 공식 챌린지는 공정한 판정을 위해 참여자 사진 인증이 필요해요.</p>}<label className="field"><span>보상 조건과 지급 안내</span><textarea value={rewardTerms} onChange={(event) => setRewardTerms(event.target.value)} maxLength={500} placeholder="완주 조건, 지급 일정과 유의사항을 적어주세요." /></label></>}
      {error && <p className="form-error">{error}</p>}
      <button className="button full" disabled={busy || rewardNeedsPhoto}>{busy ? "저장하는 중…" : editing ? "변경 내용 저장" : activeKind === "COMMUNITY" ? "500 포인트로 만들기" : "공식 챌린지 열기"}</button>
    </form>
  </Sheet>;
}
