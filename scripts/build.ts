import { rm } from "node:fs/promises";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const sourceRoot = join(projectRoot, "src");
const outputRoot = join(projectRoot, "dist");
const entrypoints = [
  join(sourceRoot, "index.ts"),
  join(sourceRoot, "three", "index.ts"),
];

await rm(outputRoot, { recursive: true, force: true });

for (const build of [
  {
    label: "ES modules",
    format: "esm" as const,
    target: "browser" as const,
    naming: "[dir]/[name].js",
  },
  {
    label: "CommonJS",
    format: "cjs" as const,
    target: "node" as const,
    naming: "[dir]/[name].cjs",
  },
]) {
  const result = await Bun.build({
    entrypoints,
    root: sourceRoot,
    outdir: outputRoot,
    external: ["three"],
    packages: "bundle",
    format: build.format,
    target: build.target,
    naming: build.naming,
    sourcemap: "linked",
  });

  if (!result.success) {
    const details = result.logs.map((log) => log.message).join("\n");
    throw new Error(`${build.label} build failed${details ? `:\n${details}` : ""}`);
  }
}
