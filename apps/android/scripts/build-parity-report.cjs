// Embed existing, unmodified synthetic captures in a portable comparison report.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'outputs/android');
const embed = file => `data:image/png;base64,${fs.readFileSync(path.join(output, file)).toString('base64')}`;
const titles = { today: '오늘', todos: 'TODO 일정', explore: '탐색', post: '게시물 상세', me: '마이', groups: 'TODO 그룹', publish: '실천 게시 시트', categories: '카테고리', person: '공개 프로필', connections: '함께하는 구름', search: '검색' };
const notes = {
  today: '완료율·지금 할 일·완료 후 게시 흐름을 맞췄습니다. 진행률 카드의 세부 크기와 그림자, 시간 표현은 아직 차이가 있습니다.',
  todos: '일정·그룹·카테고리 진입, 선택 날짜와 완료 표시를 맞췄습니다. 네이티브 날짜 선택은 공통 시트로 열립니다. 월/주 표현과 여백의 세부 대조는 더 필요합니다.',
  explore: '작성자·실천·태그·응원·댓글·가져오기 순서가 같습니다. 사진 없는 기록의 색 배치와 일부 아이콘·간격은 아직 다릅니다.',
  post: '동일한 기록과 댓글 API를 사용합니다. 상세 제목 영역, 가져오기와 보조 행동의 배치에는 차이가 남아 있습니다.',
  me: '프로필 수치·성장·그룹·최근 게시물·기본/챌린지 배지를 같은 API에서 표시합니다. 큰 글꼴에서는 기록과 배지를 한 열로 배치합니다. 여백·장식·전체 스크롤 대조는 별도 확인이 필요합니다.',
  groups: '그룹명·구성·완료 수·관리·루틴 게시의 흐름을 맞췄습니다. 앱의 다음 TODO 안내와 카드 크기·버튼 모양에는 차이가 남아 있습니다.',
  categories: '새 카테고리·분류 갤러리·별도 정렬·보관 목록을 같은 흐름으로 구성했습니다. 카드의 정보 밀도·편집 행동 배치·아이콘과 간격은 추가 대조가 필요합니다.',
  person: '동일한 공개 프로필에서 소개·게시물·팔로워·팔로잉·등급·게시한 실천을 보여줍니다. 이 캡처는 본인 프로필이며 타인의 팔로우·메시지는 별도 합성 동작 검사로 확인했습니다. 카드 높이·여백·등급 배경색(웹 민트/앱 라일락)·장식은 차이가 있습니다.',
  connections: '팔로워/팔로잉 선택과 사진·닉네임·아이디·등급을 같은 순서로 표시합니다. 앱은 커서 추가 조회를 제공합니다. 제목의 아이디 표시·카드 경계·간격은 차이가 남아 있습니다.',
  publish: '사진·한마디·태그 추가/삭제·공개 범위 순서와 설명을 웹에 맞췄습니다. 이 캡처의 사진은 미선택 상태입니다. 저장 상태 복원과 실패 재시도는 별도 합성 동작 검사이며 실제 사진 업로드 성공을 뜻하지 않습니다. 입력·사진 버튼·여백과 시트 높이에는 차이가 남습니다.',
  search: '공유 데이터의 사용자·태그·실천·루틴·챌린지를 같은 순서와 수치로 표시합니다. 최근 검색과 결과 유형 선택·실패 재시도·빈 상태를 합성 검사했습니다. 웹의 가로 탭과 앱의 줄바꿈 탭, 요약 배경색·입력·카드 간격은 차이가 남습니다.'
};
let panels = '';
for (const width of [360, 390, 430]) {
  panels += `<section class="width-panel" data-width="${width}" ${width === 390 ? '' : 'hidden'}>`;
  for (const [key, title] of Object.entries(titles)) {
    panels += `<article><h2>${title} · ${width}</h2><p>${notes[key]}</p><div class="pair">`;
    for (const [label, directory] of [['웹', 'web-parity'], ['Android', 'native-verification']]) {
      const capture = label === 'Android' ? `parity${width}` : width;
      panels += `<figure><figcaption>${label}</figcaption><img style="max-width:${width}px" src="${embed(`${directory}/${capture}/parity-${key}.png`)}" alt="${width} 크기의 ${label} ${title} 화면"></figure>`;
    }
    panels += '</div></article>';
  }
  panels += '</section>';
}
const extras = [
  ['글꼴 200% · 5탭', '360-font200/five-tabs-native.png'],
  ['글꼴 200% · Google 추가 가입 정보', 'google-font200/google-profile-ready.png'],
  ['낮은 높이 · 실패 후 TODO 초안과 재시도', '360-low/todo-failure-draft.png'],
  ['낮은 높이 · Google 추가 가입 정보', 'google-low/google-profile-ready.png'],
  ['글꼴 200% · 긴 프로필', 'profile-font200/profile-long.png'],
  ['낮은 높이 · 배지 조건 시트', 'profile-low/profile-empty-badge.png'],
  ['채팅 · 원본 사진 비율 보기', '360/chat-photo-original.png'],
  ['글꼴 200% · 그룹 선택 유지', 'group-font200/group-editor.png'],
  ['낮은 높이 · 반복 TODO 편집', 'todo-repeat-low/todo-repeat-editor.png'],
  ['카테고리 · 접근성 정렬', '360/category-order.png'],
  ['글꼴 200% · 공개 프로필', 'public-profile-font200/public-profile.png'],
  ['챌린지 · 반려 기록과 재인증 진입', 'challenge360/challenge-rejection.png'],
  ['챌린지 검수 · 원본 비율 확대', 'challenge360/challenge-review-photo-expanded.png'],
  ['챌린지 검수 · 새 시도 선택 초기화', 'challenge360/challenge-new-review-attempt.png'],
  ['글꼴 200% · 챌린지 기준별 검수', 'challenge-review-font200/challenge-new-review-attempt.png']
].map(([title, file]) => `<figure><figcaption>${title}</figcaption><img src="${embed(`native-verification/${file}`)}" alt="${title}" style="max-width:360px"></figure>`).join('');
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>뭉실 웹 · Android 비교</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#faf8f5;color:#202027;font-family:system-ui,sans-serif;line-height:1.6}main{max-width:1000px;margin:auto;padding:32px 20px}h1{font-size:28px;line-height:1.35}h2{font-size:22px}p{max-width:850px;color:#66616c}nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}button{min-height:48px;padding:10px 20px;border:1px solid #65558f;border-radius:14px;background:white;color:#65558f;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#65558f;color:white}button:focus-visible{outline:3px solid #202027;outline-offset:3px}article{padding:24px 0;border-top:1px solid #e5e0e6}.pair,.extras{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0;text-align:center}figcaption{font-weight:700;padding:12px}img{width:100%;height:auto;vertical-align:top;box-shadow:0 4px 20px #20202718;border-radius:18px}aside{background:#e8deff;padding:16px 20px;border-radius:18px}a{color:#65558f}[hidden]{display:none!important}@media(max-width:600px){.pair,.extras{grid-template-columns:1fr}main{padding:24px 16px}}
</style><main><h1>뭉실 웹 · Android 화면 비교</h1><p>2026-09-28 · 공유 합성 fixture · 웹 px / Android dp · 일반 사용자 28개 중 10개 화면과 게시 시트</p>
<aside>이 비교는 전체 기능 일치 판정이 아닙니다. 운영 데이터에 접속하지 않았으며, Google 화면은 테스트용 응답입니다. 실제 Play 로그인·푸시와 나머지 18개 화면·전체 시트 검증은 남아 있습니다. 웹 화면의 왼쪽 아래 N 아이콘은 개발 서버 표시입니다.</aside>
<nav aria-label="비교 화면 폭">${[360,390,430].map(width => `<button type="button" aria-pressed="${width === 390}" data-show="${width}">${width}</button>`).join('')}</nav>
${panels}<article><h2>작은 화면·큰 글꼴·상태 검사</h2><p>키보드를 닫은 합성 기기 검사 캡처입니다. 일부는 앱 셸을 포함하지 않는 개별 컴포넌트 하네스이며 위의 공유 화면 비교 수에 합산하지 않습니다. 실제 모바일 키보드·TalkBack·프로세스 종료 검사를 대신하지 않습니다.</p><div class="extras">${extras}</div></article></main>
<script>document.querySelectorAll('[data-show]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-show]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));document.querySelectorAll('[data-width]').forEach(panel=>panel.hidden=panel.dataset.width!==button.dataset.show)}));</script></html>`;
const destination = path.join(output, 'parity-comparison.html');
fs.writeFileSync(destination, html);
process.stdout.write(`${destination}\n`);
