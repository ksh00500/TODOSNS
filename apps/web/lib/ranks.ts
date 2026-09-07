export type CloudRank = {
  name: string;
  minimum: number;
  description: string;
};

export const CLOUD_RANKS: CloudRank[] = [
  { name: "구름씨앗", minimum: 0, description: "작은 실천을 시작한 첫 단계예요." },
  { name: "조각구름", minimum: 100, description: "하루의 실천을 차곡차곡 이어가고 있어요." },
  { name: "솜구름", minimum: 300, description: "나만의 리듬이 부드럽게 자리 잡고 있어요." },
  { name: "뭉게구름", minimum: 800, description: "꾸준한 실천이 주변에도 좋은 흐름을 만들어요." },
  { name: "노을구름", minimum: 2_000, description: "오래 이어온 기록이 선명한 빛을 내고 있어요." },
  { name: "별구름", minimum: 5_000, description: "수많은 작은 실천이 단단한 습관이 되었어요." },
];

export function rankIndexFor(power: number) {
  return CLOUD_RANKS.findLastIndex((rank) => power >= rank.minimum);
}

export function nextRankFor(power: number) {
  return CLOUD_RANKS.find((rank) => power < rank.minimum) ?? null;
}

export function rankProgressFor(power: number) {
  const next = nextRankFor(power);
  return next ? Math.min(100, Math.round((power / next.minimum) * 100)) : 100;
}
