"use client";

import { FormEvent, useState } from "react";
import { Flag } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Sheet } from "./sheet";

export function ReportSheet({
  targetType,
  targetId,
  onClose,
  onReported,
}: {
  targetType: "USER" | "POST" | "COMMENT" | "CHALLENGE";
  targetId: string;
  onClose: () => void;
  onReported?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/social/report", {
        method: "POST",
        body: JSON.stringify({ targetType, targetId, reason: reason.trim() }),
      });
      onReported?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "신고를 접수하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="신고하기" onClose={onClose}>
      <form className="composer-form" onSubmit={submit}>
        <div className="safety-note">
          <Flag />
          <p>운영자가 내용을 확인할 수 있도록 문제가 되는 이유를 구체적으로 적어주세요.</p>
        </div>
        <label className="field">
          <span>신고 이유</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={500}
            required
            placeholder="어떤 점이 불편하거나 위험했나요?"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="button full" disabled={busy || reason.trim().length < 3}>
          {busy ? "접수 중…" : "운영팀에 신고하기"}
        </button>
      </form>
    </Sheet>
  );
}
