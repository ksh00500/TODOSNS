export function shouldClearChatDraft(submittedVersion: number, currentVersion: number, succeeded: boolean) {
  return succeeded && submittedVersion === currentVersion;
}

export function isNearChatBottom(
  scroll: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = 140,
) {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < threshold;
}

export function countNewChatMessages<T extends { id: string }>(items: T[], previousId: string) {
  const previousIndex = items.findIndex((item) => item.id === previousId);
  return previousIndex < 0 ? 0 : items.length - previousIndex - 1;
}
