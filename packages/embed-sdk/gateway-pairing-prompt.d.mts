import type { GatewayPairingReview } from "../browser-runtime/openclaw-gateway.mjs";

export interface GatewayPairingDecision {
  schemaVersion: 1;
  decision: "approved" | "rejected";
  requestId: string;
  deviceId: string;
}

export interface GatewayPairingPromptModel {
  reviewId: string;
  requestId: string;
  deviceId: string;
  deviceLabel: string;
  reason: GatewayPairingReview["reason"];
  reasonLabel: string;
  requested: Readonly<{ roles: readonly string[]; scopes: readonly string[] }>;
  approved: Readonly<{ roles: readonly string[]; scopes: readonly string[] }> | null;
  expiresAt: string;
  remainingMs: number;
}

export function buildGatewayPairingPromptModel(
  review: GatewayPairingReview,
  options?: { now?: number }
): Readonly<GatewayPairingPromptModel>;

export function mountGatewayPairingPrompt(options: {
  container: HTMLElement;
  review: GatewayPairingReview;
  onApprove: (reviewId: string) => Promise<GatewayPairingDecision>;
  onReject: (reviewId: string) => Promise<GatewayPairingDecision>;
  onDecision?: (decision: Readonly<Omit<GatewayPairingDecision, "schemaVersion">>) => void;
  clock?: () => number;
}): Readonly<{
  model: Readonly<GatewayPairingPromptModel>;
  destroy(): boolean;
}>;
