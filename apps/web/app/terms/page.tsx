import Link from "next/link";
import legal from "../../../../packages/content/legal.json";
export default function LegalPage() { const document = legal.terms; return <main className="legal-page"><Link href="/start">← 돌아가기</Link><h1>{document.title}</h1>{document.blocks.map((block, index) => block.heading ? <h2 key={index}>{block.text}</h2> : <p key={index}>{block.text}</p>)}</main>; }
