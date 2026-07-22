export function shouldRetryActionAuthorization(input: Readonly<{
  actionWindowId: number;
  currentWindowId: number | undefined;
  operationBusy: boolean;
}>): boolean {
  return (
    Number.isSafeInteger(input.actionWindowId) &&
    input.actionWindowId >= 0 &&
    input.currentWindowId === input.actionWindowId &&
    !input.operationBusy
  );
}
