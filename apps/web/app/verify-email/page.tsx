"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import { apiFetch, setAccessToken } from "@/lib/api";
import { useSession } from "@/components/app-providers";
import { CloudMark } from "@/components/cloud-mark";

type VerifyResult = { accessToken: string };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthFlowState loading title="인증 링크를 확인하고 있어요" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useSession();
  const token = params.get("token");
  const email = params.get("email") ?? "";
  const emailWasSent = params.get("sent") !== "0";
  const [state, setState] = useState<"waiting" | "verifying" | "verified" | "error">(
    token ? "verifying" : "waiting",
  );
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) return;
    void apiFetch<VerifyResult>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(async (result) => {
        setAccessToken(result.accessToken);
        await refresh();
        setState("verified");
        window.setTimeout(() => router.replace("/onboarding"), 800);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "이메일을 인증하지 못했어요.");
        setState("error");
      });
  }, [token, refresh, router]);

  async function resend() {
    if (!email) return;
    setResending(true);
    setMessage("");
    try {
      await apiFetch("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage("인증 메일 전송을 다시 요청했어요. 잠시 후 메일함을 확인해주세요.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메일을 다시 보내지 못했어요.");
    } finally {
      setResending(false);
    }
  }

  if (state === "verifying") return <AuthFlowState loading title="이메일을 인증하고 있어요" />;
  if (state === "verified") {
    return <AuthFlowState success title="인증이 완료됐어요" body="관심사를 고르는 화면으로 이동할게요." />;
  }
  if (state === "error") {
    return (
      <AuthFlowState
        title="인증 링크를 사용할 수 없어요"
        body={message}
        action={<Link className="button full" href="/start">로그인으로 돌아가기</Link>}
      />
    );
  }
  return (
    <AuthFlowState
      title="메일함을 확인해주세요"
      body={emailWasSent
        ? `${email || "가입한 이메일"}로 인증 링크를 보냈어요. 링크는 24시간 동안 유효해요.`
        : "계정은 만들어졌지만 인증 메일을 보내지 못했어요. 잠시 후 아래 버튼으로 다시 요청해주세요."}
      action={
        <>
          <button className="button full secondary" onClick={resend} disabled={!email || resending}>
            <Mail /> {resending ? "보내는 중…" : "인증 메일 다시 보내기"}
          </button>
          {message && <p className="form-success">{message}</p>}
          <Link className="skip-link" href="/start">로그인으로 돌아가기</Link>
        </>
      }
    />
  );
}

function AuthFlowState({
  title,
  body,
  loading,
  success,
  action,
}: {
  title: string;
  body?: string;
  loading?: boolean;
  success?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <main className="auth-page auth-flow-page">
      <div className="auth-mobile">
        <header>
          <Link href="/" className="wordmark">
            <CloudMark />
            <b>뭉실</b>
          </Link>
        </header>
        <section className="auth-card auth-result-card">
          <span className="auth-result-icon">
            {loading ? <LoaderCircle className="spin" /> : success ? <CheckCircle2 /> : <Mail />}
          </span>
          <h1>{title}</h1>
          {body && <p>{body}</p>}
          {action}
        </section>
      </div>
    </main>
  );
}
