// security/secret-store.ts — a2s: Encrypted Secret Reference Store
// Adopted from Agent-2 architecture (agent2/core/secrets.py)
// Replaces raw plaintext API keys with "a2s:<uuid>" references backed by AES-256-GCM.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SECRET_PREFIX = "a2s:";
const ALGORITHM = "aes-256-gcm";

export interface EncryptedPayload {
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // hex
  createdAtMs: number;
}

export class SecretStore {
  private masterKey: Buffer | null = null;
  private keyFilePath: string;
  private storageFilePath: string;
  private vault = new Map<string, EncryptedPayload>();

  constructor(vaultDir?: string) {
    const dir = vaultDir || join(homedir(), ".rikkahub", "security");
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // Fallback to memory-only
      }
    }
    this.keyFilePath = join(dir, "master.key");
    this.storageFilePath = join(dir, "vault.json");
    this.initMasterKey();
    this.loadVault();
  }

  private initMasterKey(): void {
    try {
      if (existsSync(this.keyFilePath)) {
        this.masterKey = Buffer.from(readFileSync(this.keyFilePath, "utf8").trim(), "hex");
      } else {
        this.masterKey = randomBytes(32);
        writeFileSync(this.keyFilePath, this.masterKey.toString("hex"), { encoding: "utf8", mode: 0o600 });
      }
    } catch {
      this.masterKey = randomBytes(32);
    }
  }

  private loadVault(): void {
    try {
      if (existsSync(this.storageFilePath)) {
        const raw = readFileSync(this.storageFilePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, EncryptedPayload>;
        for (const [k, v] of Object.entries(parsed)) {
          this.vault.set(k, v);
        }
      }
    } catch {
      // Ignore
    }
  }

  private persistVault(): void {
    try {
      const obj: Record<string, EncryptedPayload> = {};
      for (const [k, v] of this.vault.entries()) {
        obj[k] = v;
      }
      writeFileSync(this.storageFilePath, JSON.stringify(obj, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch {
      // Ignore
    }
  }

  isSecretReference(value: string | null | undefined): boolean {
    if (!value || typeof value !== "string") return false;
    return value.startsWith(SECRET_PREFIX) && value.length > 5;
  }

  storeSecret(secret: string): string {
    if (!secret || !secret.trim()) return secret;
    if (this.isSecretReference(secret)) return secret; // Already a reference

    const id = randomBytes(16).toString("hex");
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.masterKey!, iv);

    let ciphertext = cipher.update(secret, "utf8", "hex");
    ciphertext += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");

    this.vault.set(id, {
      iv: iv.toString("hex"),
      tag,
      ciphertext,
      createdAtMs: Date.now(),
    });

    this.persistVault();
    return `${SECRET_PREFIX}${id}`;
  }

  resolveSecret(refOrValue: string | null | undefined): string {
    if (!refOrValue || typeof refOrValue !== "string") return "";
    if (!this.isSecretReference(refOrValue)) return refOrValue; // Plaintext fallback

    const id = refOrValue.slice(SECRET_PREFIX.length);
    const entry = this.vault.get(id);
    if (!entry) {
      console.warn(`[SecretStore] Secret reference "${refOrValue}" not found in vault.`);
      return "";
    }

    try {
      const iv = Buffer.from(entry.iv, "hex");
      const tag = Buffer.from(entry.tag, "hex");
      const decipher = createDecipheriv(ALGORITHM, this.masterKey!, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(entry.ciphertext, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (err) {
      console.error(`[SecretStore] Failed to decrypt secret "${refOrValue}":`, err);
      return "";
    }
  }

  deleteSecret(ref: string): boolean {
    if (!this.isSecretReference(ref)) return false;
    const id = ref.slice(SECRET_PREFIX.length);
    const deleted = this.vault.delete(id);
    if (deleted) this.persistVault();
    return deleted;
  }
}

export const secretStore = new SecretStore();
