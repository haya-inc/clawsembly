export const HELLO_AGENT_PERF_PASS_KINDS: readonly ["cold", "warm", "persistentReuse"];

export type HelloAgentPerfPassKind = (typeof HELLO_AGENT_PERF_PASS_KINDS)[number];

export interface HelloAgentPerfPhases {
  bootMs: number;
  providerBootMs: number;
  installMs: number;
  readyMs: number;
  helloRoundTripMs: number;
  closeMs: number;
}

export interface HelloAgentPerfSample {
  schemaVersion: 1;
  passKind: HelloAgentPerfPassKind;
  workspaceId: string;
  phases: HelloAgentPerfPhases;
  install: {
    integrityMatched: true;
    fileCount: number;
    stagedBytes: number;
  };
  storage: {
    beforeUsageBytes: number | null;
    afterUsageBytes: number | null;
  };
}

export interface HelloAgentPerfPassSummary {
  passKind: HelloAgentPerfPassKind;
  sampleCount: number;
  meetsSampleFloor: boolean;
  medianMs: Readonly<HelloAgentPerfPhases>;
  samples: readonly Readonly<HelloAgentPerfSample>[];
}

export interface HelloAgentPerfBaseline {
  schemaVersion: 1;
  capturedAt: string;
  target: {
    runtime: "browserpod";
    browserLocal: true;
    runtimeVersion: string;
    browser: string;
    os: string;
  };
  artifact: { package: string; version: string; integrity: string };
  scope: {
    chain: "hello-agent-reference-binding";
    upstreamApplicability: "none";
  };
  passes: Partial<Record<HelloAgentPerfPassKind, Readonly<HelloAgentPerfPassSummary>>>;
}

export function assertHelloAgentPerfSample(sample: unknown): HelloAgentPerfSample;

export function summarizeHelloAgentPerfSamples(
  passKind: HelloAgentPerfPassKind,
  samples: readonly HelloAgentPerfSample[]
): Readonly<HelloAgentPerfPassSummary>;

export function assertHelloAgentPerfBaseline(baseline: unknown): HelloAgentPerfBaseline;

export function helloAgentPerfRecord(baseline: HelloAgentPerfBaseline): Promise<Readonly<{
  id: "hello-agent-perf-baseline";
  kind: "browser-runtime-performance";
  capturedAt: string;
  path: string;
  sha256: string;
  summary: string;
}>>;
