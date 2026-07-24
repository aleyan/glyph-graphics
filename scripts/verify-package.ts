import { $ } from "bun";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "glyph-graphics-package-"));
const consumerRoot = join(temporaryRoot, "consumer");
const npmCache = join(temporaryRoot, "npm-cache");
let tarball = "";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function linkDirectory(source: string, target: string): Promise<void> {
  if (await exists(target)) return;
  await mkdir(dirname(target), { recursive: true });
  await symlink(source, target, "dir");
}

try {
  await $`bun pm pack --destination ${temporaryRoot} --ignore-scripts`
    .cwd(projectRoot)
    .quiet();
  const tarballs = (await readdir(temporaryRoot)).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1 || tarballs[0] === undefined) {
    throw new Error(`Expected one packed tarball, found ${tarballs.length}`);
  }
  tarball = join(temporaryRoot, tarballs[0]);

  await mkdir(consumerRoot, { recursive: true });
  await writeFile(
    join(consumerRoot, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await $`npm install ${tarball} --cache ${npmCache} --ignore-scripts --no-audit --no-fund --omit=peer --offline`
    .cwd(consumerRoot)
    .quiet();

  const installedRoot = join(consumerRoot, "node_modules", "glyph-graphics");
  const installedPackage = JSON.parse(
    await readFile(join(installedRoot, "package.json"), "utf8"),
  ) as { main?: string; module?: string; types?: string };

  if (
    installedPackage.main !== "./dist/index.cjs" ||
    installedPackage.module !== "./dist/index.js" ||
    installedPackage.types !== "./dist/index.d.ts"
  ) {
    throw new Error("Packed package metadata does not point to compiled output");
  }
  if (await exists(join(installedRoot, "src"))) {
    throw new Error("Packed package unexpectedly contains source files");
  }

  await $`node --input-type=module -e ${`
    import { ALEX_HARRI_LAYOUT, charsets } from "glyph-graphics";
    if (ALEX_HARRI_LAYOUT.points.length !== 6) process.exit(1);
    if ([...charsets.SHAPE_ASCII].length !== 47) process.exit(1);
  `}`.cwd(consumerRoot).quiet();
  await $`node -e ${`
    const core = require("glyph-graphics");
    if (core.ALEX_HARRI_LAYOUT.points.length !== 6) process.exit(1);
  `}`.cwd(consumerRoot).quiet();

  const coreTypeTest = join(consumerRoot, "core-consumer.ts");
  await writeFile(
    coreTypeTest,
    [
      'import { ALEX_HARRI_CELL, type AlexHarriOptions, type Frame } from "glyph-graphics";',
      "const options: AlexHarriOptions = { cols: 80, quality: 5 };",
      "const frame: Frame = { data: new Uint8Array(4), width: 1, height: 1 };",
      "void [ALEX_HARRI_CELL, options, frame];",
    ].join("\n"),
  );
  const tsc = join(projectRoot, "node_modules", "typescript", "bin", "tsc");
  await $`node ${tsc} --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext ${coreTypeTest}`
    .cwd(consumerRoot)
    .quiet();

  const coreCommonJsTypeTest = join(consumerRoot, "core-consumer.cts");
  await writeFile(
    coreCommonJsTypeTest,
    [
      'import core = require("glyph-graphics");',
      "const options: core.AlexHarriOptions = { cols: 80, quality: 5 };",
      "const frame: core.Frame = { data: new Uint8Array(4), width: 1, height: 1 };",
      "void [core.ALEX_HARRI_CELL, options, frame];",
    ].join("\n"),
  );
  await $`node ${tsc} --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext ${coreCommonJsTypeTest}`
    .cwd(consumerRoot)
    .quiet();

  await linkDirectory(
    join(projectRoot, "node_modules", "three"),
    join(consumerRoot, "node_modules", "three"),
  );
  await linkDirectory(
    join(projectRoot, "node_modules", "@types", "three"),
    join(consumerRoot, "node_modules", "@types", "three"),
  );

  await $`node --input-type=module -e ${`
    import { AsciiTilemap, buildGlyphAtlas } from "glyph-graphics/three";
    if (typeof AsciiTilemap !== "function") process.exit(1);
    if (typeof buildGlyphAtlas !== "function") process.exit(1);
  `}`.cwd(consumerRoot).quiet();
  await $`node -e ${`
    const adapter = require("glyph-graphics/three");
    if (typeof adapter.AsciiTilemap !== "function") process.exit(1);
  `}`.cwd(consumerRoot).quiet();

  const threeTypeTest = join(consumerRoot, "three-consumer.ts");
  await writeFile(
    threeTypeTest,
    [
      'import { AsciiTilemap, type AsciiTilemapOptions } from "glyph-graphics/three";',
      "const options: AsciiTilemapOptions = { background: 0x000000, useColor: true };",
      "void [AsciiTilemap, options];",
    ].join("\n"),
  );
  await $`node ${tsc} --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext ${threeTypeTest}`
    .cwd(consumerRoot)
    .quiet();

  const threeCommonJsTypeTest = join(consumerRoot, "three-consumer.cts");
  await writeFile(
    threeCommonJsTypeTest,
    [
      'import adapter = require("glyph-graphics/three");',
      "const options: adapter.AsciiTilemapOptions = { background: 0x000000, useColor: true };",
      "void [adapter.AsciiTilemap, options];",
    ].join("\n"),
  );
  await $`node ${tsc} --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext ${threeCommonJsTypeTest}`
    .cwd(consumerRoot)
    .quiet();

  const tarballStats = await lstat(tarball);
  console.log(
    `Verified ${Math.ceil(tarballStats.size / 1024)} KB package: ESM, CommonJS, types, and optional Three.js adapter.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
