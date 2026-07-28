import Link from "next/link";
import { AlertCircle, CloudOff, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import { CloudMark } from "./cloud-mark";

export function PageLoading() { return <div className="page-state loading-state" aria-label="불러오는 중"><LoaderCircle className="spin" /><span>가볍게 불러오고 있어요</span></div>; }
export function ListSkeleton({ count = 3 }: { count?: number }) { return <div className="skeleton-list" aria-hidden="true">{Array.from({ length: count }, (_, index) => <div className="skeleton-card" key={index}><i /><span><b /><small /></span></div>)}</div>; }
export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) { return <div className="page-state empty-state"><CloudMark /><b>{title}</b><p>{body}</p>{action}</div>; }
export function ErrorState({ onRetry, message = "내용을 불러오지 못했어요." }: { onRetry?: () => void; message?: string }) { return <div className="page-state"><AlertCircle /><b>{message}</b><p>연결을 확인하고 다시 시도해주세요.</p>{onRetry && <button className="button secondary" onClick={onRetry}><RefreshCw /> 다시 시도</button>}</div>; }
export function OfflineBanner() { return <div className="offline-banner"><CloudOff /> 오프라인이에요. 연결되면 자동으로 다시 시도할게요.</div>; }
export function AuthGate({ title = "로그인이 필요한 공간이에요" }: { title?: string }) { return <div className="page-state auth-gate"><LockKeyhole /><b>{title}</b><p>내 TODO와 기록은 안전하게 계정에 보관돼요.</p><Link className="button" href="/start">로그인하고 계속하기</Link></div>; }
