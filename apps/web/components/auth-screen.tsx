"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { ApiError, apiFetch, setAccessToken } from "@/lib/api";
import { CloudMark } from "./cloud-mark";
import { useSession } from "./app-providers";
import { DemoEntryButton } from "./demo-entry-button";
import { BirthDatePicker } from "./todo-form-controls";
import { GoogleSignInButton } from "./google-sign-in-button";
import type { SignupResultDto } from "@mungsil/contracts";

type LoginResult = { accessToken: string; user: { nickname: string } };
type AuthConfig = {
  inviteRequired: boolean;
  googleAuthEnabled: boolean;
  googleClientId: string | null;
};

export function AuthScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSession();
  const [signup, setSignup] = useState(params.get("mode") === "signup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [googleCredential, setGoogleCredential] = useState("");
  const [googleBirthDate, setGoogleBirthDate] = useState("");
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    inviteRequired: true,
    googleAuthEnabled: false,
    googleClientId: null,
  });

  useEffect(() => {
    let active = true;
    apiFetch<AuthConfig>("/auth/config")
      .then((config) => {
        if (active) setAuthConfig(config);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setConfigLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function finishLogin(result: LoginResult) {
    setAccessToken(result.accessToken);
    await refresh();
    const requested = params.get("returnTo");
    const safeReturn =
      requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/today";
    router.replace(safeReturn);
  }

  async function authenticateWithGoogle(
    idToken: string,
    profile?: { handle: string; birthDate: string; inviteCode?: string },
  ) {
    setGoogleBusy(true);
    setGoogleError("");
    try {
      const result = await apiFetch<LoginResult>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken, ...profile }),
      });
      await finishLogin(result);
    } catch (cause) {
      if (!profile && cause instanceof ApiError && cause.code === "GOOGLE_PROFILE_REQUIRED") {
        setGoogleCredential(idToken);
        return;
      }
      setGoogleError(cause instanceof Error ? cause.message : "Google 로그인을 완료하지 못했어요.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function submitGoogleProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGoogleError("");
    if (!googleBirthDate) {
      setGoogleError("생년월일을 선택해주세요.");
      return;
    }
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await authenticateWithGoogle(googleCredential, {
      handle: String(values.handle ?? "").toLowerCase(),
      birthDate: googleBirthDate,
      ...(authConfig.inviteRequired ? { inviteCode: String(values.inviteCode ?? "") } : {}),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (signup && !birthDate) {
      setError("생년월일을 선택해주세요.");
      return;
    }
    setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    delete values.terms;
    if (signup) values.birthDate = birthDate;
    try {
      if (signup) {
        const result = await apiFetch<SignupResultDto>("/auth/signup", {
          method: "POST",
          body: JSON.stringify(values),
        });
        const sent = result.verificationEmailSent ? "1" : "0";
        router.push(`/verify-email?email=${encodeURIComponent(result.email)}&sent=${sent}`);
        return;
      }
      const result = await apiFetch<LoginResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify(values),
      });
      await finishLogin(result);
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
          <span>
            {googleCredential
              ? "마지막 정보만 확인할게요"
              : signup
                ? "새로운 구름이 반가워요"
                : "다시 만나 반가워요"}
          </span>
          <h1>
            {googleCredential ? (
              <>
                Google 가입을
                <br />
                마무리해요.
              </>
            ) : signup ? (
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
            {googleCredential
              ? "Google 프로필 이름을 닉네임으로 사용해요. 아이디와 연령 확인 정보는 안전한 가입을 위해 필요해요."
              : signup
              ? "초대받은 사람들과 작은 실천을 나누며 천천히 나만의 구름을 키워보세요."
              : "내 TODO와 응원, 이어오던 루틴이 기다리고 있어요."}
          </p>
        </section>
        <section className="auth-card">
          {googleCredential ? (
            <form onSubmit={submitGoogleProfile}>
              <label className="field">
                <span>아이디</span>
                <input
                  name="handle"
                  pattern="[a-z0-9._]{3,20}"
                  minLength={3}
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                  placeholder="cloud.todo"
                />
                <small>영문 소문자, 숫자, 점과 밑줄을 사용할 수 있어요.</small>
              </label>
              <BirthDatePicker value={googleBirthDate} onChange={setGoogleBirthDate} />
              {authConfig.inviteRequired && (
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
              <label className="terms-check">
                <input name="terms" type="checkbox" required />
                <span>
                  <Check /> <Link href="/terms">이용약관</Link>과{" "}
                  <Link href="/privacy">개인정보 처리방침</Link>에 동의해요.
                </span>
              </label>
              {googleError && <p className="form-error">{googleError}</p>}
              <button className="button full" disabled={googleBusy}>
                {googleBusy ? (
                  <>
                    <LoaderCircle className="spin" /> 가입 중…
                  </>
                ) : (
                  <>
                    Google 가입 완료
                    <ArrowRight />
                  </>
                )}
              </button>
              <button
                className="google-setup-cancel"
                type="button"
                onClick={() => {
                  setGoogleCredential("");
                  setGoogleBirthDate("");
                  setGoogleError("");
                }}
              >
                다른 방법으로 로그인
              </button>
            </form>
          ) : (
            <>
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
            {signup && <BirthDatePicker value={birthDate} onChange={setBirthDate} />}
            {signup && authConfig.inviteRequired && (
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
              {authConfig.googleAuthEnabled && authConfig.googleClientId ? (
                <GoogleSignInButton
                  clientId={authConfig.googleClientId}
                  busy={googleBusy}
                  onCredential={(credential) => void authenticateWithGoogle(credential)}
                  onError={setGoogleError}
                />
              ) : (
                <button className="google-button" type="button" disabled>
                  <b>G</b> Google로 계속하기{" "}
                  <small>{configLoaded ? "현재 사용할 수 없음" : "설정 확인 중…"}</small>
                </button>
              )}
              {googleBusy && (
                <p className="google-login-status" role="status">
                  <LoaderCircle className="spin" /> Google 계정을 확인하고 있어요…
                </p>
              )}
              {googleError && <p className="form-error google-login-error">{googleError}</p>}
              <p className="auth-switch">
                {signup ? "이미 계정이 있나요?" : "초대 코드를 받았나요?"}
                <button
                  onClick={() => {
                    setSignup(!signup);
                    setError("");
                    setGoogleError("");
                  }}
                >
                  {signup ? "로그인" : "회원가입"}
                </button>
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
