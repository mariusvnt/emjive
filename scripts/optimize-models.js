#!/usr/bin/env node
/* ==========================================================================
   optimize-models — shrinks the product .glb files the 3D viewer downloads.

   Why this exists as a script rather than a one-off command: a model's
   weight is the single biggest thing standing between a visitor and the
   thing they came to look at, and models arrive here straight out of
   Blender, where "fine" means something completely different than it does
   over a phone connection. Before this ran, one series of eight rings was
   66.9 MB of glTF — with a single ring reaching 20.6 MB and 762k triangles
   for a shape rendered into a ~400px box. Anything added later will arrive
   the same way, so the fix has to be re-runnable, not a one-time cleanup.

   The pipeline, in order, and why each step is safe HERE specifically:

   1. Strip every texture, and every material's references to them, plus
      TEXCOORD_n / COLOR_n / TANGENT vertex attributes. This is the step
      that looks reckless and isn't: js/three-viewer.js's applyMaterial()
      replaces the material on every mesh of every model with a freshly
      built MeshStandardMaterial carrying nothing but the METAL_PRESETS
      color/metalness/roughness — unconditionally, on load and on every
      metal switch. A model's own textures and UVs are therefore already
      dead weight at runtime; they were simply being downloaded anyway.
      (If the viewer ever starts honoring a model's own maps, this step
      has to go, and this comment is the thing that should stop it being
      a mystery.)
   2. weld() — merges vertices that are identical across all remaining
      attributes. Blender exports routinely split them per-face.
   3. prune() + dedup() — drop whatever is now orphaned or duplicated.
   4. draco() — the transport compression. Lossy only in the sense that
      positions are quantized to 14 bits: across a 24mm ring that's ~1.5
      microns per step, orders of magnitude below anything the renderer,
      the screenshots, or a human can resolve.

   NOT in the pipeline by default: simplify(). Cutting triangle count is
   where the remaining order of magnitude is (see --simplify below), but it
   genuinely changes the silhouette, and these same models are what
   scripts/auto-render.js re-renders every product icon and top shot from.
   That's an art call, so it's opt-in and never runs unasked.

   Usage:
     npm run optimize-models -- --dry-run      report only, write nothing
     npm run optimize-models                   optimize every product .glb
     npm run optimize-models -- <path.glb> ... only these files
     npm run optimize-models -- --simplify=0.5 also cut ~50% of triangles

   Files are rewritten IN PLACE. Git is the undo.
   ========================================================================== */

const { readdirSync, statSync, existsSync } = require("node:fs");
const { join, resolve, relative } = require("node:path");

const REPO_ROOT = resolve(__dirname, "..");
const SERIES_ROOT = join(REPO_ROOT, "assets", "series");

// Attributes the viewer provably never reads — see step 1 above. NORMAL is
// deliberately absent: without it three.js falls back to flat per-face
// normals, which on a polished metal ring is the difference between a
// smooth highlight and a faceted one.
const DROPPED_ATTRIBUTE_PREFIXES = ["TEXCOORD_", "COLOR_", "TANGENT", "_"];

function findProductModels() {
  const found = [];
  if (!existsSync(SERIES_ROOT)) return found;
  for (const series of readdirSync(SERIES_ROOT)) {
    const productsDir = join(SERIES_ROOT, series, "products");
    if (!existsSync(productsDir) || !statSync(productsDir).isDirectory()) continue;
    for (const product of readdirSync(productsDir)) {
      const dir = join(productsDir, product);
      if (!statSync(dir).isDirectory()) continue;
      for (const file of readdirSync(dir)) {
        if (/\.glb$/i.test(file)) found.push(join(dir, file));
      }
    }
  }
  return found;
}

function mb(bytes) {
  return (bytes / 1048576).toFixed(2) + " MB";
}

function measure(document) {
  const root = document.getRoot();
  let vertices = 0;
  let triangles = 0;
  const attributes = new Set();
  // Whole-model bounds, accumulated in the primitives' own local space.
  // This is the integrity check: Draco's quantization and weld()'s merging
  // are both supposed to leave the shape where it was, so if a model's
  // extents move by anything beyond the quantization step, something in
  // the pipeline did more than it was meant to. Cheap to compute from the
  // POSITION accessors' own min/max, which glTF requires to be present.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION");
      const indices = prim.getIndices();
      vertices += position ? position.getCount() : 0;
      triangles += (indices ? indices.getCount() : position ? position.getCount() : 0) / 3;
      for (const semantic of prim.listSemantics()) attributes.add(semantic);
      if (position) {
        const lo = position.getMin([0, 0, 0]);
        const hi = position.getMax([0, 0, 0]);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], lo[i]);
          max[i] = Math.max(max[i], hi[i]);
        }
      }
    }
  }
  return {
    vertices,
    triangles: Math.round(triangles),
    attributes: [...attributes].sort(),
    textures: root.listTextures().length,
    draco: root.listExtensionsUsed().some((e) => e.extensionName === "KHR_draco_mesh_compression"),
    min,
    max
  };
}

// Largest single-axis movement of the model's bounding box, as a fraction
// of its own largest dimension — so it reads the same for a 24mm ring as
// it would for anything else, and can be compared against a fixed budget.
function boundsDrift(before, after) {
  let extent = 0;
  for (let i = 0; i < 3; i++) extent = Math.max(extent, before.max[i] - before.min[i]);
  if (!isFinite(extent) || extent === 0) return 0;
  let drift = 0;
  for (let i = 0; i < 3; i++) {
    drift = Math.max(drift, Math.abs(after.min[i] - before.min[i]), Math.abs(after.max[i] - before.max[i]));
  }
  return drift / extent;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const simplifyArg = args.find((a) => a.startsWith("--simplify"));
  // --simplify with no value means "half"; --simplify=0.25 keeps a quarter
  // of the triangles. meshoptimizer treats this as a target ratio, not a
  // guarantee — it stops early rather than wreck the silhouette.
  const simplifyRatio = simplifyArg
    ? Number(simplifyArg.split("=")[1] || 0.5)
    : null;
  const explicit = args.filter((a) => !a.startsWith("--"));

  const files = explicit.length
    ? explicit.map((p) => resolve(REPO_ROOT, p))
    : findProductModels();

  if (!files.length) {
    console.error("No .glb files found under assets/series/*/products/.");
    process.exitCode = 1;
    return;
  }

  // All of these are devDependencies — ESM-only, hence the dynamic imports
  // from this CommonJS file (the rest of scripts/ is CommonJS too).
  const { NodeIO } = await import("@gltf-transform/core");
  const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
  const { dedup, draco, prune, weld, simplify } = await import("@gltf-transform/functions");
  const draco3d = (await import("draco3dgltf")).default;
  const meshoptimizer = simplifyRatio !== null ? await import("meshoptimizer") : null;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule()
    });

  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    const sizeBefore = statSync(file).size;
    totalBefore += sizeBefore;

    const document = await io.read(file);
    const before = measure(document);

    // ---- 1. textures + attributes the viewer never reads ----------------
    for (const texture of document.getRoot().listTextures()) texture.dispose();
    for (const mesh of document.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        for (const semantic of prim.listSemantics()) {
          if (DROPPED_ATTRIBUTE_PREFIXES.some((p) => semantic.startsWith(p))) {
            prim.setAttribute(semantic, null);
          }
        }
      }
    }

    const transforms = [
      // Order matters: weld first so dedup/prune see the merged result,
      // and so simplify (if asked for) gets a properly connected mesh —
      // meshoptimizer collapses edges, and an unwelded Blender export has
      // no shared edges to collapse, which makes it a near no-op.
      weld(),
      dedup(),
      prune()
    ];
    if (simplifyRatio !== null) {
      transforms.push(simplify({ simplifier: meshoptimizer.MeshoptSimplifier, ratio: simplifyRatio, error: 0.001 }));
      transforms.push(prune());
    }
    transforms.push(draco());

    await document.transform(...transforms);

    const after = measure(document);

    if (!dryRun) {
      await io.write(file, document);
    }

    const sizeAfter = dryRun
      ? (await io.writeBinary(document)).byteLength
      : statSync(file).size;
    totalAfter += sizeAfter;

    // Read the file back off disk and decode its Draco payload, rather
    // than trusting the in-memory document we just encoded FROM. These
    // overwrite the only copy of an art asset there is, so "the encoder
    // said it was fine" isn't good enough — this is what actually proves
    // the bytes on disk decode to the same mesh, through the same Draco
    // decoder the browser will use.
    // What must hold exactly is the SURFACE: the same triangle count,
    // spanning the same extents. The vertex count deliberately gets a
    // tolerance in BOTH directions — Draco's encoder runs its own
    // dedup/reindex pass and re-splits vertices wherever quantization
    // makes two attribute corners that used to be identical diverge, so a
    // sub-percent wobble either way is the encoder doing its job, not
    // geometry being lost. A triangle-count change or any real bounds
    // movement would be.
    let verified = null;
    if (!dryRun) {
      const roundTrip = measure(await io.read(file));
      const vertexDelta = after.vertices ? Math.abs(roundTrip.vertices - after.vertices) / after.vertices : 0;
      const ok = roundTrip.triangles === after.triangles &&
                 vertexDelta <= 0.02 &&
                 boundsDrift(after, roundTrip) <= 1 / 4096;
      verified = ok ? "decodes clean" : "MISMATCH";
      if (!ok) {
        process.exitCode = 1;
        console.error("    " + rel + " did not survive a decode round trip: " +
          "triangles " + after.triangles + " -> " + roundTrip.triangles + ", " +
          "vertices " + after.vertices + " -> " + roundTrip.vertices + ", " +
          "bounds drift " + (boundsDrift(after, roundTrip) * 100).toFixed(4) + "%");
      }
    }

    const dropped = before.attributes.filter((a) => !after.attributes.includes(a));
    // 14-bit position quantization can move a vertex by at most one step
    // of a 2^14 grid spanning the model; 1/4096 leaves a 4x margin over
    // that while still being far tighter than anything simplify() would
    // produce, so a flagged model is a real signal rather than noise.
    const drift = boundsDrift(before, after);
    const DRIFT_BUDGET = 1 / 4096;
    if (drift > DRIFT_BUDGET && simplifyRatio === null) {
      console.warn("    WARNING: bounding box moved by " + (drift * 100).toFixed(3) +
        "% of the model's own size — expected under " + (DRIFT_BUDGET * 100).toFixed(3) + "%");
    }
    console.log(
      rel + "\n" +
      "    size      " + mb(sizeBefore) + "  ->  " + mb(sizeAfter) +
      "   (" + (sizeBefore ? (100 - (sizeAfter / sizeBefore) * 100).toFixed(1) : "0") + "% smaller)\n" +
      "    vertices  " + before.vertices.toLocaleString() + "  ->  " + after.vertices.toLocaleString() + "\n" +
      "    triangles " + before.triangles.toLocaleString() + "  ->  " + after.triangles.toLocaleString() + "\n" +
      "    bounds    " + (drift === 0 ? "unchanged" : "moved " + (drift * 100).toFixed(4) + "% of model size") +
      (verified ? "   [" + verified + "]" : "") + "\n" +
      "    dropped   " + (dropped.length ? dropped.join(", ") : "-") +
      (before.textures ? ", " + before.textures + " texture(s)" : "") +
      (before.draco ? "   [was already Draco]" : "")
    );
  }

  console.log(
    "\n" + (dryRun ? "DRY RUN — nothing written. " : "") +
    files.length + " model(s): " + mb(totalBefore) + "  ->  " + mb(totalAfter) +
    "   (" + (100 - (totalAfter / totalBefore) * 100).toFixed(1) + "% smaller)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
