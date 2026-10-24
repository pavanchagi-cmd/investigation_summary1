/* Retention purge for demo data (same logic as Admin → Purge). Usage: npm run db:purge */
import "./load-env";

async function main() {
  // server-only modules are guarded for Next; this script runs them directly.
  const Module = await import("node:module");
  const original = (Module.default as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load;
  (Module.default as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load = function (request: string, ...rest: unknown[]) {
    if (request === "server-only") return {};
    return original.call(this, request, ...rest);
  };
  const { purgeOldCases } = await import("../lib/admin/purge");
  console.log(JSON.stringify(await purgeOldCases(null)));
  process.exit(0);
}

main().catch((err) => {
  console.error(`Purge failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
