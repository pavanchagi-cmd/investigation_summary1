import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { allowedMime, putFile } from "@/lib/storage";
import { registerDocument } from "./service";
import type { SessionUser } from "@/lib/auth/guard";

const DEMO_DIR = path.join(process.cwd(), "seed", "files");

/** Synthetic demo document sets shipped in /seed/files/<alert number>/ (DECISIONS I13). */
export async function demoSetFor(alertNumber: string): Promise<string[]> {
  if (!/^[A-Z0-9-]+$/.test(alertNumber)) return [];
  try {
    const files = await fs.readdir(path.join(DEMO_DIR, alertNumber));
    return files.filter((f) => allowedMime(f)).sort();
  } catch {
    return [];
  }
}

export async function attachDemoDocuments(caseId: number, alertNumber: string, user: SessionUser) {
  const files = await demoSetFor(alertNumber);
  const ids: number[] = [];
  for (const f of files) {
    const buf = await fs.readFile(path.join(DEMO_DIR, alertNumber, f));
    const url = await putFile(caseId, f, buf, allowedMime(f)!);
    const doc = await registerDocument(caseId, user, { blobUrl: url, fileName: f, sizeBytes: buf.length });
    ids.push(doc.id);
  }
  return ids;
}
