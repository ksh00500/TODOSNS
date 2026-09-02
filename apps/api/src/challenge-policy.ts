export type ChallengeRankInput = {
  userId: string;
  joinedAt: Date;
  approvedCheckIns: number;
};

export type ChallengeRankResult = ChallengeRankInput & {
  rank: number;
  successRate: number;
  eligible: boolean;
  titleAwarded: string | null;
};

const utcDay = (value: Date) => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

export function challengeTotalDays(startsAt: Date, endsAt: Date) {
  return Math.max(1, Math.floor((utcDay(endsAt) - utcDay(startsAt)) / 86_400_000) + 1);
}

export function challengeLeaderboard(
  participants: ChallengeRankInput[],
  denominatorDays: number,
  completionThreshold: number,
  titles: Array<string | null | undefined> = [],
): ChallengeRankResult[] {
  const days = Math.max(1, denominatorDays);
  const threshold = Math.min(100, Math.max(1, completionThreshold));
  return [...participants]
    .sort((left, right) => right.approvedCheckIns - left.approvedCheckIns || left.joinedAt.getTime() - right.joinedAt.getTime() || left.userId.localeCompare(right.userId))
    .map((item, index) => {
      const successRate = Math.min(100, Math.round(item.approvedCheckIns / days * 100));
      const eligible = successRate >= threshold;
      return {
        ...item,
        rank: index + 1,
        successRate,
        eligible,
        titleAwarded: eligible ? titles[index] || null : null,
      };
    });
}

export const PEER_VERIFICATION = {
  minimumParticipants: 8,
  firstReview: { reviewSize: 5, approvalTarget: 4, rejectionTarget: 2 },
  reverify: { reviewSize: 7, approvalTarget: 5, rejectionTarget: 3 },
  retryHours: 24,
  maxAttempts: 3,
} as const;

export type PeerVoteResult = "MET" | "NOT_MET" | "UNSURE";

export function peerVoteVerdict(results: PeerVoteResult[]) {
  if (results.includes("NOT_MET")) return "RETRY" as const;
  if (results.includes("UNSURE")) return "UNSURE" as const;
  return "APPROVE" as const;
}

export function peerVerificationDecision(approvals: number, rejections: number, approvalTarget: number, rejectionTarget: number) {
  if (approvals >= approvalTarget) return "APPROVED" as const;
  if (rejections >= rejectionTarget) return "REJECTED" as const;
  return "PENDING" as const;
}
