// model-providers/key-roulette.test.ts
import { describe, expect, it } from "bun:test";
import { splitKey, LruKeyRoulette } from "./key-roulette";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("KeyRoulette", () => {
  it("splits keys by comma, newline, and spaces correctly", () => {
    const raw = "sk-1, sk-2\nsk-3  sk-4;sk-5";
    const keys = splitKey(raw);
    expect(keys).toEqual(["sk-1", "sk-2", "sk-3", "sk-4", "sk-5"]);
  });

  it("deduplicates keys", () => {
    const raw = "sk-1, sk-2, sk-1";
    expect(splitKey(raw)).toEqual(["sk-1", "sk-2"]);
  });

  it("returns single key unchanged", () => {
    const roulette = new LruKeyRoulette(join(tmpdir(), `test-roulette-${Date.now()}.json`));
    expect(roulette.next("sk-alone", "p1")).toBe("sk-alone");
  });

  it("cycles through multiple keys in round-robin / LRU order", () => {
    const testFile = join(tmpdir(), `test-roulette-${Date.now()}-${Math.random()}.json`);
    const roulette = new LruKeyRoulette(testFile);
    const keys = "sk-a, sk-b, sk-c";

    const k1 = roulette.next(keys, "prov1");
    const k2 = roulette.next(keys, "prov1");
    const k3 = roulette.next(keys, "prov1");

    expect(k1).toBe("sk-a");
    expect(k2).toBe("sk-b");
    expect(k3).toBe("sk-c");

    // Next selection after all 3 have been used should rotate back to least recently used (sk-a)
    const k4 = roulette.next(keys, "prov1");
    expect(k4).toBe("sk-a");

    const k5 = roulette.next(keys, "prov1");
    expect(k5).toBe("sk-b");
  });
});
