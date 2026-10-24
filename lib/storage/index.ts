import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * File storage. Vercel Blob (private) when BLOB_READ_WRITE_TOKEN is set; otherwise a local
 * directory for dev/tests (refused on Vercel). Stored URLs never reach the browser.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

const LOCAL_PREFIX = "local://";
const LOCAL_DIR = path.join(process.cwd(), ".data", "uploads");

export function storageMode(): "blob" | "local" {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (process.env.VERCEL) throw new Error("BLOB_READ_WRITE_TOKEN is not set. Connect a Blob store in the Vercel Storage tab.");
  return "local";
}

export function extensionOf(fileName: string) {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

/** Returns the canonical mime type for an allowed file name, or null when the type is not accepted. */
export function allowedMime(fileName: string): string | null {
  return ALLOWED_TYPES[extensionOf(fileName)] ?? null;
}

export function safeFileName(name: string) {
  const base = path.basename(name).replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  return base || "file";
}

/** Server-side upload (used for demo documents and local mode). */
export async function putFile(caseId: number, fileName: string, body: Buffer, mime: string): Promise<string> {
  const name = `cases/${caseId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
  if (storageMode() === "blob") {
    const { put } = await import("@vercel/blob");
    const res = await put(name, body, { access: "private", contentType: mime, addRandomSuffix: false });
    return res.url;
  }
  const full = path.join(LOCAL_DIR, name);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
  return LOCAL_PREFIX + name;
}

export async function readFile(url: string): Promise<Buffer> {
  if (url.startsWith(LOCAL_PREFIX)) {
    const rel = url.slice(LOCAL_PREFIX.length);
    const full = path.resolve(LOCAL_DIR, rel);
    if (!full.startsWith(LOCAL_DIR + path.sep)) throw new Error("Invalid local path");
    return fs.readFile(full);
  }
  const { get } = await import("@vercel/blob");
  const res = await get(url, { access: "private" });
  if (!res || res.statusCode !== 200) throw new Error("File not found in storage");
  const chunks: Uint8Array[] = [];
  const reader = res.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function deleteFile(url: string) {
  if (url.startsWith(LOCAL_PREFIX)) {
    const full = path.resolve(LOCAL_DIR, url.slice(LOCAL_PREFIX.length));
    if (full.startsWith(LOCAL_DIR + path.sep)) await fs.rm(full, { force: true });
    return;
  }
  const { del } = await import("@vercel/blob");
  await del(url);
}

/** Only URLs from our own Blob store (or local storage) may be registered as documents. */
export function isOwnStorageUrl(url: string) {
  if (url.startsWith(LOCAL_PREFIX)) return storageMode() === "local";
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/**
 * Hook for virus scanning (out of scope for the demo, spec section 12). Return a reason to
 * reject the file, or null to accept it.
 */
export async function scanUpload(_file: { fileName: string; size: number; url: string }): Promise<string | null> {
  return null;
}
