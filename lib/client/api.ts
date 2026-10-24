/** Browser-side JSON fetch helper: throws an Error with the server's message on failure. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const j = json as { error?: string; details?: { message: string }[] } | null;
    const detail = Array.isArray(j?.details) ? j!.details.map((d) => d.message).join("; ") : "";
    throw new Error([j?.error ?? `Request failed (${res.status})`, detail].filter(Boolean).join(": "));
  }
  return json as T;
}
