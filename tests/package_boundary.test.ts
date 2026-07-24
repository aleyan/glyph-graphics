import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";

const ROOT = join(import.meta.dir, "..");
const transpiler = new Bun.Transpiler({ loader: "ts" });

async function resolveLocalImport(importer: string, specifier: string): Promise<string> {
  const unresolved = resolve(dirname(importer), specifier);
  const sourceCandidate = unresolved.endsWith(".js")
    ? `${unresolved.slice(0, -3)}.ts`
    : `${unresolved}.ts`;
  for (const candidate of [unresolved, sourceCandidate, join(unresolved, "index.ts")]) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(`Could not resolve ${specifier} from ${importer}`);
}

async function runtimeDependencies(entrypoint: string): Promise<Set<string>> {
  const externals = new Set<string>();
  const visited = new Set<string>();
  const pending = [join(ROOT, entrypoint)];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const imports = transpiler.scanImports(await Bun.file(path).text());
    for (const imported of imports) {
      if (imported.path.startsWith(".")) {
        pending.push(await resolveLocalImport(path, imported.path));
      } else {
        externals.add(imported.path);
      }
    }
  }
  return externals;
}

describe("package runtime boundary", () => {
  test("only the Three.js subpath has a runtime dependency on three", async () => {
    const core = await runtimeDependencies("src/index.ts");
    const three = await runtimeDependencies("src/three/index.ts");

    expect(core.has("three")).toBe(false);
    expect(three.has("three")).toBe(true);
  });
});
