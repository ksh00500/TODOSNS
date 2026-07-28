"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { apiFetch, setAccessToken } from "@/lib/api";
import { CloudMark } from "./cloud-mark";
import { useSession } from "./app-providers";
import { DemoEntryButton } from "./demo-entry-button";

type LoginResult = { accessToken: string; user: { nickname: string } };
type SignupResult = { email: string; requiresVerification: true };

export function AuthScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const [signup, setSignup] = useState(params.get("mode") === "signup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    delete values.terms;
    try {
      if (signup) {
        const result = await apiFetch<SignupResult>("/auth/signup", {
          method: "POST",
          body: JSON.stringify(values),
        });
        router.push(`/verify-email?email=${encodeURIComponent(result.email)}`);
        return;
      }
      const result = await apiFetch<LoginResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      setAccessToken(result.accessToken);
      await refresh();
      const requested = params.get("returnTo");
      const safeReturn =
        requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/today";
      router.replace(safeReturn);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-mobile">
        <header>
          <Link href="/" className="icon-button" aria-label="홈으로">
            <ArrowLeft />
          </Link>
          <span className="wordmark">
            <CloudMark />
            <b>뭉실</b>
          </span>
          <i />
        </header>
        <section className="auth-welcome">
          <span>{signup ? "새로운 구름이 반가워요" : "다시 만나 반가워요"}</span>
          <h1>
            {signup ? (
              <>
                작은 실천을
                <br />
                함께 시작해요.
              </>
            ) : (
              <>
                오늘의 뭉실을
                <br />
                이어가 볼까요?
              </>
            )}
          </h1>
          <p>
            {signup
              ? "초대받은 사람들과 작은 실천을 나누며 천천히 나만의 구름을 키워보세요."
              : "내 TODO와 응원, 이어오던 루틴이 기다리고 있어요."}
          </p>
        </section>
        <section className="auth-card">
          <form onSubmit={submit}>
            {signup && (
              <div className="field-grid">
                <label className="field">
                  <span>닉네임</span>
                  <input
                    name="nickname"
                    minLength={2}
                    maxLength={20}
                    required
                    placeholder="뭉실에서 불릴 이름"
                  />
                </label>
                <label className="field">
                  <span>아이디</span>
                  <input
                    name="handle"
                    pattern="[a-z0-9._]{3,20}"
                    required
                    placeholder="cloud.todo"
                  />
                </label>
              </div>
            )}
            {signup && (
              <label className="field">
                <span>생년월일</span>
                <input name="birthDate" type="date" required />
              </label>
            )}
            {signup && (
              <label className="field">
                <span>초대 코드</span>
                <input
                  name="inviteCode"
                  minLength={4}
                  maxLength={80}
                  required
                  placeholder="받은 초대 코드를 입력해주세요"
                  autoCapitalize="characters"
                />
              </label>
            )}
            <label className="field">
              <span>이메일</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="hello@example.com"
              />
            </label>
            <label className="field">
              <span>비밀번호</span>
              <input
                name="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={8}
                maxLength={72}
                required
                placeholder="8자 이상 입력해주세요"
              />
            </label>
            {!signup && (
              <Link className="form-helper-link" href="/forgot-password">
                비밀번호를 잊었나요?
              </Link>
            )}
            {signup && (
              <label className="terms-check">
                <input name="terms" type="checkbox" required />
                <span>
                  <Check /> <Link href="/terms">이용약관</Link>과{" "}
                  <Link href="/privacy">개인정보 처리방침</Link>에 동의해요.
                </span>
              </label>
            )}
            {error && <p className="form-error">{error}</p>}
            <button className="button full" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle className="spin" /> 처리 중…
                </>
              ) : (
                <>
                  {signup ? "인증 메일 받기" : "로그인"}
                  <ArrowRight />
                </>
              )}
            </button>
          </form>
          <div className="auth-divider">
            <span>또는</span>
          </div>
          <DemoEntryButton className="demo-entry full" />
          <button className="google-button" type="button" disabled>
            <b>G</b> Google로 계속하기 <small>베타 이후</small>
          </button>
          <p className="auth-switch">
            {signup ? "이미 계정이 있나요?" : "초대 코드를 받았나요?"}
            <button
              onClick={() => {
                setSignup(!signup);
                setError("");
              }}
            >
              {signup ? "로그인" : "회원가입"}
            </button>
          </p>
        </section>
      </div>
    </main>
  );
}
