import Link from "next/link";
import { ArrowRight, Check, CopyPlus, HeartHandshake, ListChecks } from "lucide-react";
import { CloudMark } from "@/components/cloud-mark";
import { DemoEntryButton } from "@/components/demo-entry-button";

export default function Home() {
  return <main className="landing">
    <nav className="landing-nav"><Link href="/" className="wordmark"><CloudMark /><b>뭉실</b></Link><div><Link href="/explore">실천 둘러보기</Link><Link href="/start" className="button small">시작하기</Link></div></nav>
    <section className="landing-hero">
      <div className="landing-copy"><span className="eyebrow">오늘의 작은 실천이 내일의 습관으로</span><h1>좋아요로 끝나지 않는<br /><em>건강한 루틴 SNS</em></h1><p>해낸 일을 기록하고, 서로 가볍게 응원하고,<br />마음에 든 습관은 내 TODO로 가져오세요.</p><div className="hero-actions"><Link href="/start" className="button">무료로 시작하기 <ArrowRight /></Link><DemoEntryButton className="button demo-button" /><Link href="/explore" className="text-link">공개 루틴 둘러보기</Link></div></div>
      <div className="product-preview" aria-label="뭉실 오늘 화면 미리보기"><div className="preview-head"><CloudMark /><b>뭉실</b><span>7월 28일 화요일</span></div><h2>안녕하세요, 몽글이님!</h2><p className="preview-subtitle">오늘의 작은 실천을 이어가 볼까요?</p><div className="preview-progress"><i><span /><b>62%</b><small>오늘의 여정</small></i></div><blockquote>“작은 실천이 쌓여 나만의 리듬이 돼요.”</blockquote>{["출근 전 20분 산책", "영어 단어 30개 복습", "잠들기 전 책 10쪽"].map((item, index) => <div className={`preview-task ${index < 1 ? "done" : index === 1 ? "active" : "upcoming"}`} key={item}><span>{index < 1 && <Check />}</span><div><b>{item}</b><small>{index === 0 ? "운동" : index === 1 ? "공부 · 진행 중" : "독서"}</small></div></div>)}</div>
    </section>
    <section className="landing-values"><article><span className="value-icon blue"><ListChecks /></span><b>오늘 할 일을 가볍게</b><p>복잡한 계획보다 지금 실천할 수 있는 일에 집중해요.</p></article><article><span className="value-icon pink"><HeartHandshake /></span><b>비교 대신 응원</b><p>숫자 경쟁 없이 서로의 작은 성취를 다정하게 북돋아요.</p></article><article><span className="value-icon mint"><CopyPlus /></span><b>좋은 습관을 내 하루로</b><p>마음에 든 TODO와 루틴을 그대로 가져와 실천해요.</p></article></section>
  </main>;
}
