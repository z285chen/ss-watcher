export type DesignCaptureAvailabilityInput = Readonly<{
  detachedCaptureMode: boolean;
  hasSessionHandle: boolean;
  operationBusy: boolean;
  sourceExportBusy: boolean;
}>;

/**
 * A detached controller can recover an expired short-lived session handle on
 * demand because its URL already pins the explicitly selected target tab. The
 * button must stay actionable so that click can perform that rebind.
 */
export function canAttemptDesignCapture(input: DesignCaptureAvailabilityInput): boolean {
  if (input.operationBusy || input.sourceExportBusy) return false;
  return input.hasSessionHandle || input.detachedCaptureMode;
}
