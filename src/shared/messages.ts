import type {
  EndpointExecutionResult,
  EndpointRequest,
} from "../core/network/request-policy";
import type {
  CollectorProbeResult,
  ShopifyProbeResult,
} from "../content/probes";
import type {
  ResourceDescriptor,
  ResourceFetchResult,
} from "../core/frontend/resource-types";

export type SessionHandle = {
  runId: string;
  sessionToken: string;
};

export type SessionSummary = {
  origin: string;
  pathname: string;
  tabId: number;
  documentId: string;
};

/**
 * Service-worker broadcast emitted only after Chrome has delivered a real
 * toolbar action click. It contains no credential and merely asks the Side
 * Panel in the clicked window to retry its fail-closed session handshake.
 */
export type M0ActionAuthorizedNotice = {
  type: "M0_ACTION_AUTHORIZED";
  windowId: number;
  tabId: number;
};

export type M0Request =
  | {
      type: "M0_ESTABLISH_SESSION";
      windowId: number;
      panelInstanceId: string;
    }
  | {
      type: "M0_RUN_PROBES";
      handle: SessionHandle;
      panelInstanceId: string;
      /** Present for a cancellable scan; omitted by the standalone probe action. */
      scanId?: string;
    }
  | {
      type: "M0_VALIDATE_SESSION";
      handle: SessionHandle;
      panelInstanceId: string;
    }
  | {
      type: "M0_FETCH_ENDPOINT";
      handle: SessionHandle;
      panelInstanceId: string;
      endpoint: EndpointRequest;
      routeRoot?: string;
      scanId?: string;
    }
  | {
      type: "M3_FETCH_RESOURCE";
      handle: SessionHandle;
      panelInstanceId: string;
      resourceId: string;
      scanId: string;
    }
  | {
      type: "M3_FINISH_RESOURCE_SCAN";
      handle: SessionHandle;
      panelInstanceId: string;
      scanId: string;
    }
  | {
      type: "M1_CANCEL_SCAN";
      handle: SessionHandle;
      panelInstanceId: string;
      scanId: string;
    }
  | {
      type: "M0_REVOKE_SESSION";
      handle: SessionHandle;
      panelInstanceId: string;
    }
  | { type: "M0_GET_BOOT_ID" };

export type M0ErrorResponse = {
  ok: false;
  bootId: string;
  message: string;
  reason: string;
  diagnostic?: Record<string, unknown>;
};

export type EstablishSessionResponse =
  | {
      ok: true;
      bootId: string;
      session: SessionHandle & SessionSummary;
    }
  | M0ErrorResponse;

export type ProbeResponse =
  | {
      ok: true;
      bootId: string;
      session: SessionSummary;
      main: ShopifyProbeResult | null;
      collector: CollectorProbeResult;
      resources: ResourceDescriptor[];
    }
  | M0ErrorResponse;

export type ValidateSessionResponse =
  | {
      ok: true;
      bootId: string;
      session: SessionSummary;
    }
  | M0ErrorResponse;

export type EndpointResponse =
  | {
      ok: true;
      bootId: string;
      result: EndpointExecutionResult;
    }
  | M0ErrorResponse;

export type ResourceResponse =
  | {
      ok: true;
      bootId: string;
      result: ResourceFetchResult;
    }
  | M0ErrorResponse;

export type RevokeResponse =
  | { ok: true; bootId: string; revoked: true }
  | M0ErrorResponse;

export type CancelScanResponse =
  | {
      ok: true;
      bootId: string;
      cancelled: boolean;
      capabilitiesCleared: true;
    }
  | M0ErrorResponse;

export type FinishResourceScanResponse =
  | { ok: true; bootId: string; finished: boolean }
  | M0ErrorResponse;

export type BootResponse = { ok: true; bootId: string } | M0ErrorResponse;

export type M0Response =
  | EstablishSessionResponse
  | ValidateSessionResponse
  | ProbeResponse
  | EndpointResponse
  | ResourceResponse
  | CancelScanResponse
  | FinishResourceScanResponse
  | RevokeResponse
  | BootResponse;
