export interface GatewayDeviceTokenSubject {
  deviceId: string;
  role: string;
}

export interface GatewayDeviceTokenRecord extends GatewayDeviceTokenSubject {
  token: string;
  scopes: readonly string[];
  issuedAtMs?: number;
}

export interface GatewayDeviceTokenMetadata extends GatewayDeviceTokenSubject {
  scopes: readonly string[];
  issuedAtMs?: number;
  createdAt: string;
  updatedAt: string;
  keyExtractable: false;
  algorithm: "AES-GCM-256";
}

export interface GatewayDeviceTokenVault {
  readonly schemaVersion: 1;
  load(subject: GatewayDeviceTokenSubject): Promise<Readonly<{
    token: string;
    scopes: readonly string[];
    issuedAtMs?: number;
  }> | undefined>;
  store(record: GatewayDeviceTokenRecord): Promise<Readonly<GatewayDeviceTokenMetadata>>;
  metadata(subject: GatewayDeviceTokenSubject): Promise<Readonly<GatewayDeviceTokenMetadata> | undefined>;
  clear(subject: GatewayDeviceTokenSubject): Promise<boolean>;
}

export interface GatewayDeviceTokenPersistence {
  readKey(): Promise<CryptoKey | undefined>;
  addKey(key: CryptoKey): Promise<void>;
  readToken(id: string): Promise<unknown>;
  writeToken(id: string, record: unknown): Promise<void>;
  deleteToken(id: string): Promise<void>;
}

export function createIndexedDbGatewayDeviceTokenPersistence(options?: {
  indexedDB?: IDBFactory;
}): Readonly<GatewayDeviceTokenPersistence>;

export function createGatewayDeviceTokenVault(options?: {
  artifact?: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  crypto?: Crypto;
  persistence?: GatewayDeviceTokenPersistence;
  now?: () => number;
}): Readonly<GatewayDeviceTokenVault>;
