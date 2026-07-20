import type {
  EndpointExecutionResult,
  EndpointRequest,
} from "../core/network/request-policy";
import type {
  CollectorProbeResult,
  ShopifyProbeResult,
} from "../content/probes";

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
    }
  | M0ErrorResponse;

export type EndpointResponse =
  | {
      ok: true;
      bootId: string;
      result: EndpointExecutionResult;
    }
  | M0ErrorResponse;

export type RevokeResponse =
  | { ok: true; bootId: string; revoked: true }
  | M0ErrorResponse;

export type CancelScanResponse =
  | { ok: true; bootId: string; cancelled: boolean }
  | M0ErrorResponse;

export type BootResponse = { ok: true; bootId: string } | M0ErrorResponse;

export type M0Response =
  | EstablishSessionResponse
  | ProbeResponse
  | EndpointResponse
  | CancelScanResponse
  | RevokeResponse
  | BootResponse;
