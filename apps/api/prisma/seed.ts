import { ChallengeKind, PrismaClient, VerificationMode, Visibility } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();
async function main() {
  const birthDate = new Date("1995-01-01");
  const admin = await prisma.user.upsert({ where: { email: "admin@mungsil.local" }, update: {}, create: { email: "admin@mungsil.local", passwordHash: await hash("Mungsil!234", 12), nickname: "뭉실 운영자", handle: "mungsil.official", birthDate, role: "ADMIN", availablePoints: 2000, lifetimePower: 2200, recentVitality: 180 } });
  const demo = await prisma.user.upsert({ where: { email: "demo@mungsil.local" }, update: {}, create: { email: "demo@mungsil.local", passwordHash: await hash("Mungsil!234", 12), nickname: "하늘", handle: "sky.todo", birthDate, availablePoints: 750, lifetimePower: 860, recentVitality: 92 } });
  const todo = await prisma.todo.create({ data: { userId: demo.id, title: "저녁 산책 30분", notes: "좋아하는 음악과 함께", category: "건강", visibility: Visibility.PUBLIC, dueDate: new Date(), completedAt: new Date() } });
  await prisma.post.create({ data: { authorId: demo.id, caption: "오늘도 가볍게 한 바퀴 ☁️", visibility: Visibility.PUBLIC, todos: { create: { todoId: todo.id } } } });
  await prisma.challenge.upsert({ where: { id: "official-morning-30" }, update: {}, create: { id: "official-morning-30", creatorId: admin.id, title: "30일 아침 루틴", description: "매일 아침 나만의 작은 루틴을 완료하고 함께 인증해요.", kind: ChallengeKind.OFFICIAL, verificationMode: VerificationMode.OPTIONAL_PHOTO, startsAt: new Date(Date.now() - 86400_000), endsAt: new Date(Date.now() + 30 * 86400_000), rewardLabel: "완주자 공식 배지", rewardTerms: "운영자 검토 후 지급" } });
}
main().finally(() => prisma.$disconnect());
