"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Check, CloudSun, LoaderCircle } from "lucide-react";
import { apiFetch } from "../lib/api";
import { CloudMark } from "./cloud-mark";

type AuthResult = { accessToken: string; user: { nickname: string } };

export function AuthScreen() {
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await apiFetch<AuthResult>(signup ? "/auth/signup" : "/auth/login", { method: "POST", body: JSON.stringify(values) });
      localStorage.setItem("mungsil_access_token", result.accessToken);
      window.location.assign("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "잠시 후 다시 시도해주세요."); }
    finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-story">
      <div className="auth-brand"><CloudMark /><b>뭉실</b></div>
      <div><span className="eyebrow"><CloudSun size={16} /> 작은 실천이 모여 구름이 돼요</span><h1>오늘 해낸 일을<br />가볍게 나눠보세요.</h1><p>TODO를 완료하고, 서로 응원하고,<br />마음에 든 실천은 그대로 가져올 수 있어요.</p></div>
      <ul><li><Check />완료하면 바로 공유</li><li><Check />나도 할래요로 TODO 복제</li><li><Check />꾸준할수록 둥실 오르는 등급</li></ul>
    </section>
    <section className="auth-panel">
      <div className="auth-card"><header><span>{signup ? "새 구름으로 시작해요" : "다시 떠오를 시간이에요"}</span><h2>{signup ? "뭉실 가입" : "로그인"}</h2></header>
        <form onSubmit={submit}>
          {signup && <><label>닉네임<input name="nickname" minLength={2} maxLength={20} required placeholder="어떻게 불러드릴까요?" /></label><label>아이디<input name="handle" pattern="[a-z0-9._]{3,20}" required placeholder="cloud.todo" /></label><label>생년월일<input name="birthDate" type="date" required /></label></>}
          <label>이메일<input name="email" type="email" required placeholder="hello@example.com" /></label>
          <label>비밀번호<input name="password" type="password" minLength={8} required placeholder="8자 이상" /></label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <>{signup ? "가입하고 시작" : "로그인"}<ArrowRight size={18} /></>}</button>
        </form>
        <p className="auth-switch">{signup ? "이미 계정이 있나요?" : "처음 오셨나요?"}<button onClick={() => { setSignup(!signup); setError(""); }}>{signup ? "로그인" : "회원가입"}</button></p>
        {signup && <small className="auth-terms">MVP는 만 18세 이상만 가입할 수 있으며, 가입 시 이용약관과 개인정보 처리방침에 동의한 것으로 봅니다.</small>}
      </div>
    </section>
  </main>;
}
