"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type SheetLayer = {
  id: symbol;
  root: React.RefObject<HTMLElement | null>;
};

const sheetLayers: SheetLayer[] = [];
let lockSnapshot: {
  app: HTMLElement | null;
  appScroll: HTMLElement | null;
  appWasInert: boolean;
  bodyOverflow: string;
  appOverflow: string;
} | null = null;
let pageReturnFocus: HTMLElement | null = null;

function isTopSheet(id: symbol) {
  return sheetLayers.at(-1)?.id === id;
}

function lockApp() {
  if (lockSnapshot) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (active && active !== document.body && active.id !== "app-content" && !active.closest(".sheet")) {
    pageReturnFocus = active;
  }
  const app = document.querySelector<HTMLElement>(".mobile-app");
  const appScroll = document.getElementById("app-content");
  lockSnapshot = {
    app,
    appScroll,
    appWasInert: app?.hasAttribute("inert") ?? false,
    bodyOverflow: document.body.style.overflow,
    appOverflow: appScroll?.style.overflow ?? "",
  };
  app?.setAttribute("inert", "");
  document.body.style.overflow = "hidden";
  if (appScroll) appScroll.style.overflow = "hidden";
}

function unlockApp() {
  if (!lockSnapshot) return;
  const snapshot = lockSnapshot;
  lockSnapshot = null;
  if (!snapshot.appWasInert) snapshot.app?.removeAttribute("inert");
  document.body.style.overflow = snapshot.bodyOverflow;
  if (snapshot.appScroll) snapshot.appScroll.style.overflow = snapshot.appOverflow;
}

function focusFirst(root: HTMLElement | null) {
  const first = root?.querySelector<HTMLElement>(
    'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
  );
  (first ?? root)?.focus();
}

function isUsableReturnFocus(element: HTMLElement | null) {
  return Boolean(
    element?.isConnected &&
      element !== document.body &&
      element.id !== "app-content" &&
      !element.closest(".sheet"),
  );
}

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const layerId = useRef(Symbol("sheet-layer"));
  const titleId = useId();
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = layerId.current;
    sheetLayers.push({ id, root: sheet });
    lockApp();
    const focusable = () =>
      Array.from(
        sheet.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    requestAnimationFrame(() => {
      if (isTopSheet(id)) focusFirst(sheet.current);
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopSheet(id)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = sheetLayers.findIndex((layer) => layer.id === id);
      const wasTop = index === sheetLayers.length - 1;
      if (index >= 0) sheetLayers.splice(index, 1);
      if (!sheetLayers.length) unlockApp();
      requestAnimationFrame(() => {
        if (!wasTop) return;
        const nextTop = sheetLayers.at(-1)?.root.current ?? null;
        if (nextTop) {
          if (previous?.isConnected && nextTop.contains(previous)) previous.focus({ preventScroll: true });
          else focusFirst(nextTop);
        }
        else {
          const target = isUsableReturnFocus(previous)
            ? previous
            : isUsableReturnFocus(pageReturnFocus)
              ? pageReturnFocus
              : document.getElementById("app-content");
          target?.focus({ preventScroll: true });
        }
      });
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && isTopSheet(layerId.current)) onClose();
      }}
    >
      <section
        ref={sheet}
        className="sheet"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <i className="sheet-handle" aria-hidden="true" />
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
