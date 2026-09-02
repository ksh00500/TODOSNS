UPDATE "Challenge"
SET "verificationMode" = 'CHECK'
WHERE "verificationMode" = 'OPTIONAL_PHOTO'
  AND ("kind" = 'COMMUNITY' OR "rewardLabel" IS NULL);

UPDATE "Challenge"
SET
  "verificationMode" = 'PEER_PHOTO',
  "verificationCriteria" = ARRAY[
    '사진만 보고 오늘 실천을 완료했다고 판단할 수 있나요?',
    '사진이 챌린지 주제와 맞나요?',
    '재사용하거나 조작한 흔적 없이 자연스러운 인증인가요?'
  ]::TEXT[]
WHERE "verificationMode" = 'REQUIRED_PHOTO'
   OR ("verificationMode" = 'OPTIONAL_PHOTO' AND "kind" = 'OFFICIAL' AND "rewardLabel" IS NOT NULL);
