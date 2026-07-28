"use client";

import { FormEvent, useState } from "react";
import { CalendarDays, Coins } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Sheet } from "./sheet";

const dateInput = (offset: number) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export function ChallengeComposer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(dateInput(0));
  const [endsAt, setEndsAt] = useState(dateInput(20));
  const [verificationMode, setVerificationMode] = useState("CHECK");
  const [rewardLabel, setRewardLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiFetch("/challenges", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          kind: "COMMUNITY",
          verificationMode,
          startsAt: new Date(`${startsAt}T00:00:00`).toISOString(),
          endsAt: new Date(`${endsAt}T23:59:59`).toISOString(),
          rewardLabel: rewardLabel.trim() || undefined,
        }),
      });
      onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "챌린지를 만들지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="커뮤니티 챌린지 만들기" onClose={onClose}>
      <form className="composer-form challenge-form" onSubmit={submit}>
        <div className="point-cost-note"><Coins aria-hidden /><div><b>500 포인트</b><small>개설 즉시 차감되며 취소해도 반환되지 않아요.</small></div></div>
        <label className="field"><span>챌린지 이름</span><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={2} maxLength={120} required placeholder="예: 잠들기 전 책 10쪽" /></label>
        <label className="field"><span>함께할 약속</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={1000} required placeholder="누구나 이해할 수 있도록 실천 방법을 적어주세요." /></label>
        <div className="field-grid">
          <label className="field"><span><CalendarDays aria-hidden /> 시작일</span><input type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
          <label className="field"><span><CalendarDays aria-hidden /> 종료일</span><input type="date" value={endsAt} min={startsAt} onChange={(event) => setEndsAt(event.target.value)} required /></label>
        </div>
        <label className="field"><span>인증 방식</span><select value={verificationMode} onChange={(event) => setVerificationMode(event.target.value)}><option value="CHECK">체크만</option><option value="OPTIONAL_PHOTO">사진 선택</option><option value="REQUIRED_PHOTO">사진 필수</option></select></label>
        <label className="field"><span>완주 칭호 (선택)</span><input value={rewardLabel} onChange={(event) => setRewardLabel(event.target.value)} maxLength={120} placeholder="예: 밤독서가" /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="button full" disabled={busy}>{busy ? "만드는 중…" : "500 포인트로 만들기"}</button>
      </form>
    </Sheet>
  );
}
