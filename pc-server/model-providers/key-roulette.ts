// model-providers/key-roulette.ts — Multi-API-Key Round-Robin & LRU Rotation
// Ported from rikkahub-agent (Pyth0nkod3r fork) KeyRoulette.kt

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dataDir } from "../foundation/paths";

export interface KeyRoulette {
  next(keys: string, providerId?: string): string;
  splitKeys(keys: string): string[];
}

const SPLIT_KEY_REGEX = /[\s,;\n\r]+/;

export function splitKey(key: string): string[] {
  if (!key) return [];
  return key
    .split(SPLIT_KEY_REGEX)
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .filter((k, idx, arr) => arr.indexOf(k) === idx);
}

const EXPIRE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

type LruCache = Record<string, Record<string, number>>;

export class LruKeyRoulette implements KeyRoulette {
  private cachePath: string;
  private memoryCache: LruCache | null = null;
  private writeTimer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(customPath?: string) {
    this.cachePath = customPath || join(dataDir, "lru_key_roulette.json");
  }

  splitKeys(keys: string): string[] {
    return splitKey(keys);
  }

  private loadCache(): LruCache {
    if (this.memoryCache) return this.memoryCache;
    try {
      if (existsSync(this.cachePath)) {
        const text = readFileSync(this.cachePath, "utf8");
        this.memoryCache = JSON.parse(text) as LruCache;
        return this.memoryCache;
      }
    } catch {
      // Ignore corrupted cache
    }
    this.memoryCache = {};
    return this.memoryCache;
  }

  private scheduleSave(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      try {
        const dir = join(this.cachePath, "..");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        if (this.memoryCache) {
          writeFileSync(this.cachePath, JSON.stringify(this.memoryCache, null, 2), "utf8");
        }
      } catch {
        // Disk write failure is non-fatal
      }
    }, 200);
  }

  next(keys: string, providerId: string = "default"): string {
    const keyList = splitKey(keys);
    if (keyList.length === 0) return keys;
    if (keyList.length === 1) return keyList[0];

    const now = Date.now() * 1000 + (this.seq++ % 1000);
    const allCache = this.loadCache();
    const providerCache: Record<string, number> = allCache[providerId] || {};

    // Filter out expired keys or keys no longer in the list
    const activeCache: Record<string, number> = {};
    for (const [k, lastUsed] of Object.entries(providerCache)) {
      if (keyList.includes(k) && now - lastUsed < EXPIRE_DURATION_MS * 1000) {
        activeCache[k] = lastUsed;
      }
    }

    // 1. Pick first key that hasn't been used yet
    let selected = keyList.find((k) => !(k in activeCache));

    // 2. Otherwise pick the least recently used key (minimum timestamp)
    if (!selected) {
      let minTime = Infinity;
      for (const k of keyList) {
        const t = activeCache[k] ?? 0;
        if (t < minTime) {
          minTime = t;
          selected = k;
        }
      }
    }

    selected = selected || keyList[0];

    // Update timestamp
    activeCache[selected] = now;
    allCache[providerId] = activeCache;
    this.memoryCache = allCache;
    this.scheduleSave();

    return selected;
  }
}

export const keyRoulette = new LruKeyRoulette();
