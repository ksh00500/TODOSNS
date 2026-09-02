"use client";

import { AlertTriangle } from "lucide-react";
import { Sheet } from "./sheet";

export function ConfirmSheet({ title, body, confirmLabel, busyLabel = "처리 중…", danger = false, busy = false, error = "", onClose, onConfirm }: { title: string; body: string; confirmLabel: string; busyLabel?: string; danger?: boolean; busy?: boolean; error?: string; onClose: () => void; onConfirm: () => void }) {
  return <Sheet title={title} onClose={onClose}><div className="confirm-sheet-content"><AlertTriangle aria-hidden /><p>{body}</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="confirm-sheet-actions"><button className={`button full ${danger ? "danger-button" : ""}`} disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button><button className="skip-link" disabled={busy} onClick={onClose}>돌아가기</button></div></div></Sheet>;
}
