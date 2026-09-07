"use client";

import { useEffect, useRef, useState } from "react";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdentity = {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: "popup" | "redirect";
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      text: "continue_with";
      shape: "rectangular";
      logo_alignment: "left";
      locale: "ko";
      width: number;
    },
  ): void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}

export function GoogleSignInButton({
  clientId,
  busy,
  onCredential,
  onError,
}: {
  clientId: string;
  busy: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const buttonRoot = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onCredentialRef.current = onCredential;
    onErrorRef.current = onError;
  }, [onCredential, onError]);

  useEffect(() => {
    let active = true;
    const scriptId = "google-identity-services";

    const render = () => {
      if (!active || !buttonRoot.current || !window.google?.accounts.id) return;
      const width = Math.min(400, Math.max(220, Math.floor(buttonRoot.current.clientWidth)));
      buttonRoot.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: "popup",
        callback: (response) => {
          if (response.credential) onCredentialRef.current(response.credential);
          else onErrorRef.current("Google 계정 정보를 받지 못했어요. 다시 시도해주세요.");
        },
      });
      window.google.accounts.id.renderButton(buttonRoot.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
        locale: "ko",
        width,
      });
      setReady(true);
    };

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (window.google?.accounts.id) {
      render();
      return () => {
        active = false;
      };
    }

    const script = existing ?? document.createElement("script");
    const handleError = () => {
      if (!active) return;
      setReady(false);
      onErrorRef.current("Google 로그인을 불러오지 못했어요. 네트워크 연결을 확인해주세요.");
    };
    script.addEventListener("load", render);
    script.addEventListener("error", handleError);
    if (!existing) {
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client?hl=ko";
      script.async = true;
      document.head.appendChild(script);
    }

    return () => {
      active = false;
      script.removeEventListener("load", render);
      script.removeEventListener("error", handleError);
    };
  }, [clientId]);

  return (
    <div className={`google-signin${busy ? " busy" : ""}`} aria-busy={busy}>
      <div ref={buttonRoot} className="google-signin-rendered" />
      {!ready && (
        <button className="google-button" type="button" disabled>
          Google 로그인 불러오는 중…
        </button>
      )}
    </div>
  );
}
