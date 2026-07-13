export interface HelloAgentArtifactFile {
  relativePath: string;
  bytes: number;
  sha256: string;
  contents: string;
}

export interface HelloAgentArtifact {
  schemaVersion: 1;
  name: "clawsembly-hello-agent";
  version: string;
  integrity: string;
  tarballBytes: number;
  registryPublished: false;
  protocol: "clawsembly-hello/1";
  protocolFile: "protocol.json";
  protocolSha256: string;
  entrypoint: "hello-agent.mjs";
  files: readonly Readonly<HelloAgentArtifactFile>[];
}

export const HELLO_AGENT_ARTIFACT: Readonly<HelloAgentArtifact>;
