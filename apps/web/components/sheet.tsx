"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

export function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [onClose]);
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="sheet" role="dialog" aria-modal="true" aria-label={title}><i className="sheet-handle" /><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="닫기"><X /></button></header>{children}</section></div>;
}
