import { afterEach, describe, expect, it } from "vitest";
import { blobToken, storageMode } from "@/lib/storage";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("blob token discovery", () => {
  it("uses BLOB_READ_WRITE_TOKEN when present", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_abc_123";
    expect(blobToken()).toBe("vercel_blob_rw_abc_123");
    expect(storageMode()).toBe("blob");
  });

  it("finds a token connected with a custom prefix", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.CHAT_BOT15_READ_WRITE_TOKEN = "vercel_blob_rw_store_secret";
    expect(blobToken()).toBe("vercel_blob_rw_store_secret");
  });

  it("ignores unrelated *_READ_WRITE_TOKEN values and falls back to local storage off Vercel", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
    process.env.OTHER_READ_WRITE_TOKEN = "not-a-blob-token";
    expect(blobToken()).toBeUndefined();
    expect(storageMode()).toBe("local");
  });

  it("refuses local storage on Vercel", () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.VERCEL = "1";
    expect(() => storageMode()).toThrow(/Blob store/);
  });
});
