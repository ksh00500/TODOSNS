"use client";

import { FormEvent, useState } from "react";
import { ImagePlus, LockKeyhole, UploadCloud } from "lucide-react";
import { Sheet } from "./sheet";
import { uploadImage } from "@/lib/api";
import type { TodoDto, TodoListDto, Visibility } from "@/lib/types";

export function ShareSheet({ todo, list, busy, onClose, onShare }: { todo?: TodoDto | null; list?: TodoListDto | null; busy?: boolean; onClose: () => void; onShare: (data: { caption: string; visibility: Visibility; mediaId?: string }) => void }) {
  const [caption, setCaption] = useState(""); const [visibility, setVisibility] = useState<Visibility>("PUBLIC"); const [file, setFile] = useState<File | null>(null); const [uploading, setUploading] = useState(false); const [progress, setProgress] = useState(0); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); let mediaId: string | undefined; try { if (file) { setUploading(true); mediaId = await uploadImage(file, setProgress); } onShare({ caption, visibility, mediaId }); } catch (cause) { setError(cause instanceof Error ? cause.message : "사진을 올리지 못했어요."); } finally { setUploading(false); } };
  const title = todo?.title ?? list?.title ?? "완료한 실천";
  return <Sheet title="실천 공유" onClose={onClose}><form className="share-form" onSubmit={submit}><div className="share-success"><UploadCloud /><span><b>이 실천을 나눠볼까요?</b><small>{title}</small></span></div><label className="photo-picker"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><ImagePlus /><span><b>{file ? file.name : "인증 사진 추가"}</b><small>선택 사항 · 최대 10MB</small></span></label>{uploading && <div className="upload-progress"><i style={{ width: `${progress}%` }} /><span>{progress}%</span></div>}<label className="field"><span>오늘의 한마디</span><textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={180} placeholder="실천하면서 어떤 기분이었나요?" /></label><label className="field"><span><LockKeyhole /> 공개 범위</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}><option value="PUBLIC">전체 공개</option><option value="FOLLOWERS">팔로워 공개</option><option value="PRIVATE">나만 보기</option></select></label>{error && <p className="form-error">{error}</p>}<button className="button full" disabled={busy || uploading}>{busy ? "공유 중…" : "완료 인증 공유하기"}</button></form></Sheet>;
}
