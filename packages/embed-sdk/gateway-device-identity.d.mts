export interface OpenClawDeviceIdentityStore {
  read(): Promise<unknown>;
  add(record: unknown): Promise<boolean>;
}

export interface OpenClawDeviceConnectInput {
  clientId: string;
  clientMode: string;
  role: string;
  scopes: readonly string[];
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}

export interface BrowserDeviceIdentity {
  readonly schemaVersion: 1;
  descriptor(): Promise<Readonly<{
    deviceId: string;
    publicKey: string;
    algorithm: "Ed25519";
    createdAt: string;
    privateKeyExtractable: false;
  }>>;
  signConnect(params: OpenClawDeviceConnectInput): Promise<Readonly<{
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  }>>;
}

export function createIndexedDbDeviceIdentityStore(options?: {
  indexedDB?: IDBFactory;
}): Readonly<OpenClawDeviceIdentityStore>;

export function createBrowserDeviceIdentity(options?: {
  crypto?: Crypto;
  store?: OpenClawDeviceIdentityStore;
  now?: () => number;
}): Readonly<BrowserDeviceIdentity>;

export function normalizeDeviceMetadataForAuth(value?: string | null): string;
export function buildDeviceAuthPayloadV3(params: OpenClawDeviceConnectInput & {
  deviceId: string;
  signedAtMs: number;
}): string;
