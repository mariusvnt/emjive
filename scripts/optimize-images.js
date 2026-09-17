#!/usr/bin/env node
/* ==========================================================================
   optimize-images — converts stray PNG/JPEG source art under assets/ to
   WebP, the format everything else on this site already uses.

   Same reasoning as scripts/optimize-models.js, for the other half of the
   payload: art arrives from a camera or a render in whatever format the
   tool that made it emits, and nothing downstream squeezes it. One product
   photo set shipped as PNG was 8.4 MB for a page whose entire 3D model is
   under 0.3 MB — a single x-ray backdrop at 6.38 MB, larger than every
   model in the catalog put together after Draco.

   Deliberately NOT part of scripts/auto-render.js: that script GENERATES
   images (icons, top shots, swatches) and already writes WebP. This one
   only touches art a human dropped in by hand, which auto-render never
   looks at.

   What it does not do: rewrite the paths in data/series/<slug>/products.json
   that point at the files it converts. That's one hand edit per converted
   file, and it's deliberate — a script that silently rewrites the catalog
   while also deleting the original art is a worse trade than a script that
   prints exactly which lines you need to change. It lists them at the end.

   Usage:
     npm run optimize-images -- --dry-run     report only, write nothing
     npm run optimize-images                  convert every PNG/JPEG
     npm run optimize-images -- <path> ...    only these files

   Originals are DELETED once converted (git is the undo), because leaving
   them would mean the repo carries both copies forever.
   ========================================================================== */

const { readdirSync, statSync, existsSync, unlinkSync } = require("node:fs");
const { join, resolve, relative, dirname, basename, extname } = require("node:path");

const REPO_ROOT = resolve(__dirname, "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");

// Quality 82 is where WebP stops being distinguishable from the source for
// photographic content at these sizes, and is the same figure
// scripts/auto-render.js uses for its own generated output — one number
// for the whole site rather than two that can drift.
const WEBP_QUALITY = 82;

// Nothing on this site is displayed wider than a 4K hero, and a product
// photo renders into a box a few hundred px across. Anything past this is
// paying for pixels no layout can ever show. Applied only when a source
// exceeds it — smaller art is never upscaled.
const MAX_DIMENSION = 2048;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(png|jpe?g)$/i.test(name)) out.push(full);
  }
  return out;
}

function mb(bytes) {
  return (bytes / 1048576).toFixed(2) + " MB";
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const explicit = args.filter((a) => !a.startsWith("--"));

  const files = explicit.length
    ? explicit.map((p) => resolve(REPO_ROOT, p))
    : existsSync(ASSETS_ROOT) ? walk(ASSETS_ROOT, []) : [];

  if (!files.length) {
    console.log("No PNG/JPEG files found under assets/ — nothing to do.");
    return;
  }

  const sharp = require("sharp");
  let totalBefore = 0;
  let totalAfter = 0;
  const renames = [];

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    const outPath = join(dirname(file), basename(file, extname(file)) + ".webp");
    const outRel = relative(REPO_ROOT, outPath).replace(/\\/g, "/");

    if (existsSync(outPath)) {
      console.log(rel + "\n    skipped — " + outRel + " already exists");
      continue;
    }

    const sizeBefore = statSync(file).size;
    const meta = await sharp(file).metadata();
    const tooBig = Math.max(meta.width, meta.height) > MAX_DIMENSION;

    let pipeline = sharp(file);
    if (tooBig) pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true });
    // Alpha is load-bearing for most of this art (x-ray overlays, cutout
    // product shots composited over the page background), so it's carried
    // through rather than flattened.
    const buffer = await pipeline.webp({ quality: WEBP_QUALITY, alphaQuality: 90, effort: 6 }).toBuffer();

    totalBefore += sizeBefore;
    totalAfter += buffer.length;

    if (!dryRun) {
      await sharp(buffer).toFile(outPath);
      unlinkSync(file);
    }
    renames.push({ from: rel, to: outRel });

    const out = await sharp(buffer).metadata();
    console.log(
      rel + "\n" +
      "    " + mb(sizeBefore) + "  ->  " + mb(buffer.length) +
      "   (" + (100 - (buffer.length / sizeBefore) * 100).toFixed(1) + "% smaller)\n" +
      "    " + meta.width + "x" + meta.height + "  ->  " + out.width + "x" + out.height +
      (tooBig ? "   [capped at " + MAX_DIMENSION + "px]" : "")
    );
  }

  if (!renames.length) return;

  console.log(
    "\n" + (dryRun ? "DRY RUN — nothing written. " : "") +
    renames.length + " image(s): " + mb(totalBefore) + "  ->  " + mb(totalAfter) +
    "   (" + (100 - (totalAfter / totalBefore) * 100).toFixed(1) + "% smaller)"
  );
  console.log("\nUpdate these paths by hand (data/series/<slug>/products.json, and dev-guidelines/assets.md):");
  for (const r of renames) console.log("  " + r.from + "  ->  " + r.to);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
