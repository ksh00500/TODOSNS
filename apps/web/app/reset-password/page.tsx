"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CloudMark } from "@/components/cloud-mark";

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordContent /></Suspense>;
}

function ResetPasswordContent() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("비밀번호가 서로 같지 않아요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      router.replace("/start?reset=1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "비밀번호를 변경하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page auth-flow-page">
      <div className="auth-mobile">
        <header>
          <Link href="/" className="wordmark"><CloudMark /><b>뭉실</b></Link>
        </header>
        <section className="auth-card auth-result-card">
          <span className="auth-result-icon"><KeyRound /></span>
          <h1>새 비밀번호를 정해주세요</h1>
          {!token ? (
            <>
              <p>재설정 토큰이 없어요. 새 링크를 요청해주세요.</p>
              <Link className="button full" href="/forgot-password">링크 다시 받기</Link>
            </>
          ) : (
            <form onSubmit={submit}>
              <label className="field">
                <span>새 비밀번호</span>
                <input name="password" type="password" minLength={8} maxLength={72} autoComplete="new-password" required />
              </label>
              <label className="field">
                <span>새 비밀번호 확인</span>
                <input name="confirmation" type="password" minLength={8} maxLength={72} autoComplete="new-password" required />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button className="button full" disabled={busy}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
