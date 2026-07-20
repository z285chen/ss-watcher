import { shallowRef, type ShallowRef } from "vue";

import type { CommittedSnapshotBundle } from "../core/storage/staging-store";

/**
 * Keeps an immutable committed snapshot outside Vue's deep-proxy conversion.
 * Chrome structuredClone rejects Proxy objects, while the product and export
 * views intentionally clone committed records before presenting them.
 */
export function createCommittedBundleState(): ShallowRef<
  CommittedSnapshotBundle | undefined
> {
  return shallowRef<CommittedSnapshotBundle>();
}
