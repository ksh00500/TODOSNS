"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CloudMark } from "@/components/cloud-mark";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      await apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page auth-flow-page">
      <div className="auth-mobile">
        <header>
          <Link href="/start" className="icon-button" aria-label="로그인으로">
            <ArrowLeft />
          </Link>
          <span className="wordmark"><CloudMark /><b>뭉실</b></span>
          <i />
        </header>
        <section className="auth-card auth-result-card">
          <span className="auth-result-icon"><Mail /></span>
          <h1>{sent ? "메일함을 확인해주세요" : "비밀번호를 다시 설정해요"}</h1>
          <p>{sent ? "가입된 계정이라면 1시간 동안 사용할 수 있는 링크를 보냈어요." : "가입할 때 사용한 이메일을 입력해주세요."}</p>
          {!sent && (
            <form onSubmit={submit}>
              <label className="field">
                <span>이메일</span>
                <input name="email" type="email" autoComplete="email" required />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button className="button full" disabled={busy}>{busy ? "보내는 중…" : "재설정 링크 받기"}</button>
            </form>
          )}
          <Link className="skip-link" href="/start">로그인으로 돌아가기</Link>
        </section>
      </div>
    </main>
  );
}
