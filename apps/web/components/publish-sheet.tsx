"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { Check, Globe2, Hash, ImagePlus, LockKeyhole, UploadCloud, UsersRound, X } from "lucide-react";
import { Sheet } from "./sheet";
import { ConfirmSheet } from "./confirm-sheet";
import { uploadImage, userErrorMessage } from "@/lib/api";
import type { TodoDto, TodoListDto, Visibility } from "@/lib/types";

type PublishData = { caption: string; visibility: Visibility; hashtags: string[]; mediaId?: string };
const visibilityOptions: ReadonlyArray<{ value: Visibility; label: string; description: string; icon: typeof Globe2 }> = [
  { value: "PUBLIC", label: "전체 공개", description: "탐색에서 누구나 볼 수 있어요", icon: Globe2 },
  { value: "FOLLOWERS", label: "팔로워", description: "나를 팔로우한 사람만 봐요", icon: UsersRound },
  { value: "PRIVATE", label: "나만 보기", description: "내 기록으로만 남겨요", icon: LockKeyhole },
];

export function PublishSheet({ todo, list, busy, onClose, onPublish }: { todo?: TodoDto | null; list?: TodoListDto | null; busy?: boolean; onClose: () => void; onPublish: (data: PublishData) => Promise<unknown> }) {
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedMediaId, setUploadedMediaId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const processing = submitting || busy;
  const dirty = Boolean(caption || hashtags.length || tagDraft || file || visibility !== "PUBLIC");
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    let mediaId = uploadedMediaId;
    try {
      if (file && !mediaId) {
        setUploading(true);
        mediaId = await uploadImage(file, setProgress);
        setUploadedMediaId(mediaId);
      }
      await onPublish({ caption, visibility, hashtags, mediaId });
    } catch (cause) {
      setError(userErrorMessage(cause, "실천을 게시하지 못했어요."));
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  };
  const chooseFile = (next: File | null) => { setFile(next); setPreviewUrl(next ? URL.createObjectURL(next) : ""); setUploadedMediaId(undefined); setProgress(0); setError(""); };
  const clearFile = () => chooseFile(null);
  const addTag = (value = tagDraft) => {
    const tag = value.normalize("NFKC").trim().replace(/^#+/, "").toLocaleLowerCase("ko");
    if (!tag || hashtags.includes(tag)) { setTagDraft(""); return; }
    if (!/^[\p{L}\p{N}_]+$/u.test(tag)) { setError("해시태그는 글자, 숫자, 밑줄만 사용할 수 있어요."); return; }
    if (hashtags.length >= 5) { setError("해시태그는 5개까지 추가할 수 있어요."); return; }
    setHashtags((current) => [...current, tag]); setTagDraft(""); setError("");
  };
  const title = todo?.title ?? list?.title ?? "완료한 실천";
  return <><Sheet title="실천 게시하기" onClose={() => { if (processing) return; if (dirty) setDiscardOpen(true); else onClose(); }}><form className="publish-form" onSubmit={submit} aria-busy={processing}><div className="publish-intro"><UploadCloud /><span><b>이 실천을 게시할까요?</b><small>{title}</small></span></div><div className="photo-picker-shell"><label className="photo-picker"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" disabled={processing} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />{previewUrl ? <Image className="publish-photo-preview" src={previewUrl} alt="게시할 인증 사진 미리보기" width={72} height={72} unoptimized /> : <ImagePlus />}<span><b>{file ? file.name : "인증 사진 추가"}</b><small>선택 사항 · 최대 10MB</small></span></label>{file && <button type="button" className="publish-photo-remove" disabled={processing} onClick={clearFile} aria-label="인증 사진 제거"><X /></button>}</div>{uploading && <div className="upload-progress"><i style={{ width: `${progress}%` }} /><span>{progress}%</span></div>}<label className="field"><span>오늘의 한마디</span><textarea value={caption} disabled={processing} onChange={(event) => setCaption(event.target.value)} maxLength={180} placeholder="실천하면서 어떤 기분이었나요?" /></label><div className="tag-composer"><div><b>해시태그</b><small>{hashtags.length}/5 · 선택 사항</small></div><div className="tag-entry"><Hash aria-hidden /><input value={tagDraft} disabled={processing} maxLength={30} aria-label="해시태그 입력" placeholder="예: 아침루틴" onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTag(); } }} /><button type="button" onClick={() => addTag()} disabled={processing || !tagDraft.trim()}>추가</button></div>{hashtags.length > 0 && <div className="tag-chips" aria-label="추가한 해시태그">{hashtags.map((tag) => <span key={tag}>#{tag}<button type="button" disabled={processing} aria-label={`${tag} 해시태그 삭제`} onClick={() => setHashtags((current) => current.filter((item) => item !== tag))}><X aria-hidden /></button></span>)}</div>}<p>Enter 또는 쉼표로 추가할 수 있어요.</p></div><fieldset className="visibility-picker" disabled={processing}><legend>공개 범위</legend><div>{visibilityOptions.map((option) => { const Icon = option.icon; const selected = visibility === option.value; return <button type="button" key={option.value} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => setVisibility(option.value)}><span><Icon aria-hidden /></span><span><b>{option.label}</b><small>{option.description}</small></span><i aria-hidden>{selected && <Check />}</i></button>; })}</div></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<button className="button full" disabled={processing}>{processing ? uploading ? "사진 올리는 중…" : "게시 중…" : "피드에 게시하기"}</button></form></Sheet>{discardOpen && <ConfirmSheet title="게시 작성을 닫을까요?" body="입력한 문구와 선택한 사진은 저장되지 않아요." confirmLabel="작성 내용 버리기" danger onClose={() => setDiscardOpen(false)} onConfirm={onClose} />}</>;
}
