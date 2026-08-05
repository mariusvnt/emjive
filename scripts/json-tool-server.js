#!/usr/bin/env node
/* ==========================================================================
   json-tool-server — bare static/API server for json-tool.html, a
   standalone dev page for editing global catalog parameters
   (data/series.json's featured/categories/hdris/metals), editing or adding
   a series, and editing or adding a series' products — including
   drag-and-drop for the hand-owned asset files (3D model, x-ray, extra
   photos) — writing the right JSON fields and dispatching dropped files
   into the right folders automatically.

   Deliberately has no swatch-scene editing at all (swatch-primitive/
   swatch-hdri/swatch-camera) — scripts/scene-tool-server.js already owns
   that, with a live preview this file has no equivalent for. This file's
   GET /api/data still surfaces a read-only drift warning if the existing
   swatch-scene data looks broken, but nothing here can write to it.

   Usage:
     node scripts/json-tool-server.js
     npm run json-tool

   Modeled directly on scripts/scene-tool-server.js's own shape (ROUTES
   map, readJsonBody/sendJson, path-traversal-guarded serveStatic) and
   scripts/auto-render.js's slug()/productFolder()/drift-warning logic —
   duplicated rather than imported, consistent with this repo's own
   tolerance for that trade-off (see scene-tool-server.js's own header
   comment). The JSON-text-surgery primitives this tool specifically needs
   beyond what those two files already have (inserting a whole new product/
   series/category/hdri/metal, not just patching a field that already
   exists) live in scripts/json-tool-blocks.js, a plain sibling module.

   Three scope decisions this file deliberately never crosses:
   1. No auto-render integration — never shells out to `npm run
      auto-render`/Puppeteer/sharp. Only writes JSON + hand-owned asset
      files; regenerating icons stays a manual terminal step afterward.
   2. No writes to assets.icons/assets.fallback-img/assets.top-shot, ever,
      for any metal — renderProductBlock always copies those three per-
      metal maps straight from the current on-disk product, never from
      form input, so there is no code path here that could touch them.
   3. New metals only ever touch data/series.json's "metals" array —
      js/three-viewer.js and css/style.css are never opened by this file.

   Deliberately outside Vite entirely (not in vite.config.js's
   rollupOptions.input, same as scene-tool.html/auto-render.js) — this is
   an authoring tool, not a page the live site ever serves.
   ========================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const blocks = require("./json-tool-blocks");

const ROOT = path.resolve(__dirname, "..");
const SERIES_JSON_PATH = path.join(ROOT, "data", "series.json");
const PORT = 5201;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".hdr": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".css": "text/css"
};

const KNOWN_SWATCH_PRIMITIVES = ["cylinder", "box", "sphere", "torus"];
const MODEL_EXTS = [".glb", ".gltf"];
const IMAGE_EXTS = [".png", ".webp", ".jpg", ".jpeg"];

// ---- small shared helpers ----

// Base64 inflates ~33% over raw bytes, and model files run "a few MB" per
// dev-guidelines/procedures.md — generous enough for that plus a batch of
// photos in one request, small enough to fail loudly on anything absurd
// rather than hang reading forever.
const MAX_BODY_BYTES = 60 * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function extOf(filename) {
  return path.extname(String(filename || "")).toLowerCase();
}

function findSeriesEntry(seriesIndex, seriesSlug) {
  return (seriesIndex.series || []).find((s) => s.slug === seriesSlug) || null;
}

// Defensive check before any recursive folder delete below — every folder
// this file ever removes is built by joining trusted path segments onto
// ROOT, but segments derived from a stored series slug or a product's own
// (hand-editable) name/category are one hop removed from raw JSON content,
// not the same validated-at-write-time strings isAllowedAssetDestPath
// already guards for writes. A slug/category containing "/" or ".." here
// would otherwise let a stale or hand-corrupted data/series.json escape
// ROOT on delete even though it never could have on write.
function isSafeSlugSegment(s) {
  return typeof s === "string" && /^[a-z0-9-]+$/.test(s);
}

// Every product's own products.json file, parsed, keyed by series slug —
// used by the various "is this still in use elsewhere" checks below
// (category/hdri/metal removal, and computing metal-cascade rewrites).
function loadAllProductsData(seriesIndex) {
  const bySlug = {};
  for (const s of seriesIndex.series || []) {
    const absPath = path.join(ROOT, s.products);
    bySlug[s.slug] = { absPath, data: JSON.parse(fs.readFileSync(absPath, "utf8")) };
  }
  return bySlug;
}

// Repo-root-relative output folder for one product's hand-owned assets,
// built from the series layout the same way scripts/auto-render.js's own
// productFolder() does — from the product's current name+category, not
// from wherever assets.model happens to already point.
function productFolder(seriesSlug, name, category) {
  return "assets/series/" + seriesSlug + "/products/" + blocks.slug(name) + "_" + category;
}

// Next sequential id within one series' products.json — ids are only
// unique *within* a single series' file (see dev-guidelines/data.md), so
// every series restarts at "01". Preserves the existing ids' zero-padding
// width rather than hardcoding 2 digits.
function nextProductId(productsData) {
  const ids = (productsData.products || []).map((p) => String(p.id));
  const numeric = ids.map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n));
  const max = numeric.length ? Math.max.apply(null, numeric) : 0;
  const width = ids.reduce((w, id) => Math.max(w, id.length), 2);
  return String(max + 1).padStart(width, "0");
}

// Read-only, non-blocking — ports scripts/auto-render.js's own
// warnCategoryDrift/warnHdriDrift/warnSwatchSceneDrift (console.warn there)
// into plain strings collected for GET /api/data's response instead.
function collectDriftWarnings(seriesIndex, seriesData) {
  const warnings = [];
  const categoryVocabulary = Object.keys(seriesIndex.categories || {});
  const hdriVocabulary = Object.keys(seriesIndex.hdris || {});

  for (const entry of seriesIndex.series || []) {
    for (const cat of entry.categories || []) {
      if (!categoryVocabulary.includes(cat)) {
        warnings.push('series "' + entry.slug + '" declares category "' + cat + '" which isn\'t in data/series.json\'s top-level "categories"');
      }
    }
    const productsData = (seriesData[entry.slug] || {}).products;
    if (productsData) {
      for (const product of productsData.products || []) {
        if (!(entry.categories || []).includes(product.category)) {
          warnings.push('[' + entry.slug + '] ' + product.name + ' is category "' + product.category + '", which that series doesn\'t declare — it won\'t be reachable by any filter');
        }
      }
    }
    if (!entry.hdri || !hdriVocabulary.includes(entry.hdri)) {
      warnings.push('series "' + entry.slug + '" declares hdri "' + entry.hdri + '" which isn\'t in data/series.json\'s top-level "hdris"');
    }
  }

  const swatchHdri = seriesIndex["swatch-hdri"];
  if (swatchHdri && !hdriVocabulary.includes(swatchHdri)) {
    warnings.push('top-level "swatch-hdri" is "' + swatchHdri + '" which isn\'t in data/series.json\'s top-level "hdris"');
  }
  const swatchPrimitive = seriesIndex["swatch-primitive"];
  if (swatchPrimitive && !KNOWN_SWATCH_PRIMITIVES.includes(swatchPrimitive)) {
    warnings.push('top-level "swatch-primitive" is "' + swatchPrimitive + '" which isn\'t one of: ' + KNOWN_SWATCH_PRIMITIVES.join(", "));
  }
  return warnings;
}

// ---- asset-path safety — defense in depth beyond serveStatic's own
// root-containment check below. Every write/delete destination must match
// one of these two shapes AND must never look like an auto-render-owned
// filename (belt-and-suspenders: renderProductBlock never even accepts
// icons/fallback-img/top-shot from form input, so no caller in this file
// ever builds such a path — but a bad destPath reaching here at all should
// still be rejected outright, not just produce a wrong-looking file). ----

const PRODUCT_ASSET_PATH_RE = /^assets\/series\/[a-z0-9-]+\/products\/[a-z0-9-]+_[a-z0-9-]+\/[^/]+$/;
// Same shape as PRODUCT_ASSET_PATH_RE minus the trailing filename — used to
// validate a product's whole FOLDER (not one file in it) before a
// recursive delete; see isSafeSlugSegment's comment for why this can't
// just trust productFolder()'s output the way a single-file write already
// gets to via isAllowedAssetDestPath.
const PRODUCT_ASSET_FOLDER_RE = /^assets\/series\/[a-z0-9-]+\/products\/[a-z0-9-]+_[a-z0-9-]+$/;
const HDRI_ASSET_PATH_RE = /^assets\/hdri\/[^/]+\.hdr$/i;
const AUTO_RENDER_OWNED_RE = /_(icon|fallback-img|top-shot)_/;

function isAllowedAssetDestPath(destPath) {
  if (typeof destPath !== "string" || !destPath) return false;
  if (destPath.includes("..") || destPath.startsWith("/") || /^[a-zA-Z]:/.test(destPath)) return false;
  const normalized = toPosix(destPath);
  if (AUTO_RENDER_OWNED_RE.test(path.basename(normalized))) return false;
  return PRODUCT_ASSET_PATH_RE.test(normalized) || HDRI_ASSET_PATH_RE.test(normalized);
}

function writeBase64File(destPath, contentBase64) {
  if (!isAllowedAssetDestPath(destPath)) throw new Error("destPath not allowed: " + destPath);
  const absPath = path.join(ROOT, destPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, Buffer.from(String(contentBase64 || ""), "base64"));
}

function moveAssetFile(oldRel, newRel, moved, warnings) {
  const oldAbs = path.join(ROOT, oldRel);
  const newAbs = path.join(ROOT, newRel);
  if (!fs.existsSync(oldAbs)) {
    warnings.push("expected file missing, could not move: " + oldRel);
    return;
  }
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  try {
    fs.renameSync(oldAbs, newAbs);
    moved.push({ from: oldRel, to: newRel });
  } catch (err) {
    warnings.push("failed to move " + oldRel + " to " + newRel + ": " + err.message);
  }
}

// ---- GET /api/data — one merged blob the front-end renders its whole
// form from: the parsed series index, every series' parsed products +
// manifest plus a server-computed next product id, and read-only drift
// warnings. ----

async function handleGetData(req, res) {
  const seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesData = {};
  for (const s of seriesIndex.series || []) {
    const productsAbsPath = path.join(ROOT, s.products);
    const productsData = JSON.parse(fs.readFileSync(productsAbsPath, "utf8"));
    let manifestData = null;
    const manifestAbsPath = path.join(ROOT, s.manifest);
    if (fs.existsSync(manifestAbsPath)) manifestData = JSON.parse(fs.readFileSync(manifestAbsPath, "utf8"));
    seriesData[s.slug] = { products: productsData, manifest: manifestData, nextProductId: nextProductId(productsData) };
  }
  const driftWarnings = collectDriftWarnings(seriesIndex, seriesData);
  sendJson(res, 200, { seriesIndex, seriesData, driftWarnings });
}

// ---- global-parameter writes ----

async function handleGlobalFeatured(req, res) {
  const body = await readJsonBody(req);
  if (body.featured === undefined) return sendJson(res, 400, { error: "featured is required" });

  const text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  const seriesIndex = JSON.parse(text);
  if (!findSeriesEntry(seriesIndex, body.featured)) return sendJson(res, 400, { error: "unknown series: " + body.featured });

  const patched = blocks.updateTopLevelScalarInText(text, "featured", '"' + blocks.esc(body.featured) + '"');
  if (!patched) return sendJson(res, 404, { error: 'could not find "featured" in data/series.json' });

  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");
  sendJson(res, 200, { ok: true });
}

// Where a category key is still relied on: any series declaring it in its
// own "categories" list, or any product (in any series) whose "category"
// field is this key. Both would break — a series filter button that can
// never match, or a product that vanishes from every filtered view —
// which is why removal below blocks rather than warns.
function findCategoryUsages(seriesIndex, key) {
  const usages = [];
  const productsBySlug = loadAllProductsData(seriesIndex);
  for (const s of seriesIndex.series || []) {
    if ((s.categories || []).includes(key)) usages.push('series "' + s.slug + '" declares it');
    const pd = productsBySlug[s.slug];
    for (const p of (pd && pd.data.products) || []) {
      if (p.category === key) usages.push('[' + s.slug + '] ' + p.name + " uses it");
    }
  }
  return usages;
}

async function handleGlobalCategory(req, res) {
  const body = await readJsonBody(req);
  const key = String(body.key || "").trim();
  if (!key) return sendJson(res, 400, { error: "key is required" });

  const text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  const seriesIndex = JSON.parse(text);
  const exists = Object.prototype.hasOwnProperty.call(seriesIndex.categories || {}, key);

  if (body.mode === "remove") {
    if (!exists) return sendJson(res, 404, { error: "unknown category: " + key });
    const usages = findCategoryUsages(seriesIndex, key);
    if (usages.length) {
      return sendJson(res, 409, { error: 'category "' + key + '" is still in use — ' + usages.join("; ") + " — update those first" });
    }
    const patched = blocks.removeObjectEntryInText(text, '"categories": {', key);
    if (!patched) return sendJson(res, 500, { error: 'could not patch "categories" in data/series.json' });
    fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");
    return sendJson(res, 200, { ok: true });
  }

  const sizes = Array.isArray(body.sizes) ? body.sizes : [];
  const unit = body.unit || "";
  const valueText = '{ "sizes": [' + sizes.map((s) => '"' + blocks.esc(s) + '"').join(", ") + '], "unit": "' + blocks.esc(unit) + '" }';

  let patched;
  if (body.mode === "edit") {
    if (!exists) return sendJson(res, 404, { error: "unknown category: " + key });
    patched = blocks.updateObjectEntryInText(text, '"categories": {', key, valueText);
  } else {
    if (exists) return sendJson(res, 409, { error: "category already exists: " + key });
    patched = blocks.insertBeforeObjectClose(text, '"categories": {', '    "' + key + '": ' + valueText);
  }
  if (!patched) return sendJson(res, 500, { error: 'could not patch "categories" in data/series.json' });
  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");
  sendJson(res, 200, { ok: true });
}

// Where an hdri key is still relied on: any series' own "hdri" field, or
// the top-level "swatch-hdri" (that field isn't editable from this tool —
// see the file header — but removing the .hdr file out from under it
// would still silently break scene-tool.html's swatch preview, so it's
// still worth blocking on).
function findHdriUsages(seriesIndex, key) {
  const usages = [];
  for (const s of seriesIndex.series || []) {
    if (s.hdri === key) usages.push('series "' + s.slug + '" uses it');
  }
  if (seriesIndex["swatch-hdri"] === key) usages.push('the top-level "swatch-hdri" uses it');
  return usages;
}

async function handleGlobalHdri(req, res) {
  const body = await readJsonBody(req);
  const key = String(body.key || "").trim();

  const text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  const seriesIndex = JSON.parse(text);
  const exists = Object.prototype.hasOwnProperty.call(seriesIndex.hdris || {}, key);

  if (body.mode === "remove") {
    if (!exists) return sendJson(res, 404, { error: "unknown hdri: " + key });
    const usages = findHdriUsages(seriesIndex, key);
    if (usages.length) {
      return sendJson(res, 409, { error: 'hdri "' + key + '" is still in use — ' + usages.join("; ") + " — update those first" });
    }
    const hdriPath = seriesIndex.hdris[key];
    const patched = blocks.removeObjectEntryInText(text, '"hdris": {', key);
    if (!patched) return sendJson(res, 500, { error: 'could not patch "hdris" in data/series.json' });
    fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");
    if (hdriPath && HDRI_ASSET_PATH_RE.test(hdriPath)) {
      const absPath = path.join(ROOT, hdriPath);
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    }
    return sendJson(res, 200, { ok: true });
  }

  const hdriPath = body.path;
  if (!key || !hdriPath) return sendJson(res, 400, { error: "key and path are required" });
  if (!HDRI_ASSET_PATH_RE.test(hdriPath)) return sendJson(res, 400, { error: "path must look like assets/hdri/<file>.hdr" });

  let patched;
  if (body.mode === "edit") {
    if (!exists) return sendJson(res, 404, { error: "unknown hdri: " + key });
    patched = blocks.updateObjectEntryInText(text, '"hdris": {', key, '"' + blocks.esc(hdriPath) + '"');
  } else {
    if (exists) return sendJson(res, 409, { error: "hdri key already exists: " + key });
    patched = blocks.insertBeforeObjectClose(text, '"hdris": {', '    "' + key + '": "' + blocks.esc(hdriPath) + '"');
  }
  if (!patched) return sendJson(res, 500, { error: 'could not patch "hdris" in data/series.json' });
  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");
  sendJson(res, 200, { ok: true });
}

async function handleGlobalMetal(req, res) {
  const body = await readJsonBody(req);
  const metal = String(body.metal || "").trim();
  if (!metal || !/^[a-z0-9-]+$/.test(metal)) return sendJson(res, 400, { error: "metal must be a lowercase kebab-case name" });

  const text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  const seriesIndex = JSON.parse(text);
  const exists = (seriesIndex.metals || []).includes(metal);

  if (body.mode === "remove") {
    if (!exists) return sendJson(res, 404, { error: "unknown metal: " + metal });
    const newMetals = (seriesIndex.metals || []).filter((m) => m !== metal);
    if (!newMetals.length) return sendJson(res, 409, { error: "cannot remove the last remaining metal" });

    const productsBySlug = loadAllProductsData(seriesIndex);
    const usedAsDefault = [];
    for (const s of seriesIndex.series || []) {
      for (const p of (productsBySlug[s.slug] && productsBySlug[s.slug].data.products) || []) {
        if (p["default-metal"] === metal) usedAsDefault.push("[" + s.slug + "] " + p.name);
      }
    }
    if (usedAsDefault.length) {
      return sendJson(res, 409, {
        error: 'metal "' + metal + '" is the default metal for: ' + usedAsDefault.join(", ") + " — change their default metal first"
      });
    }

    const patched = blocks.removeFromInlineStringArray(text, '"metals": [', metal);
    if (!patched) return sendJson(res, 500, { error: 'could not patch "metals" in data/series.json' });
    fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");

    // Cascade cleanup: strip the removed metal's key from every product's
    // per-metal-specs/icons/fallback-img/top-shot, in every series, by
    // re-rendering each product block against the NEW metals list —
    // renderProductBlock only ever emits keys for the metals it's given,
    // so this alone is enough; no separate per-object key-deletion needed.
    for (const s of seriesIndex.series || []) {
      const entry = productsBySlug[s.slug];
      let pText = fs.readFileSync(entry.absPath, "utf8");
      let changed = false;
      for (const p of entry.data.products || []) {
        const blockText = blocks.renderProductBlock(p, newMetals);
        const next = blocks.replaceProductBlockInText(pText, p.id, blockText);
        if (next) {
          pText = next;
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(entry.absPath, pText, "utf8");
    }

    return sendJson(res, 200, {
      ok: true,
      reminder:
        'Removed "' + metal + '" from data/series.json\'s metals list and from every product\'s per-metal-specs/icons/' +
        "fallback-img/top-shot. Still worth doing by hand if you want a full cleanup (harmless if left, just dead code): " +
        "remove METAL_PRESETS." + metal + " from js/three-viewer.js and the .product-metals__option[data-metal=\"" + metal +
        '"] rule from css/style.css.'
    });
  }

  if (exists) return sendJson(res, 409, { error: "metal already exists: " + metal });

  const patched = blocks.appendToInlineStringArray(text, '"metals": [', metal);
  if (!patched) return sendJson(res, 500, { error: 'could not patch "metals" in data/series.json' });
  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");

  sendJson(res, 200, {
    ok: true,
    reminder:
      'Added "' + metal + '" to data/series.json\'s metals list. Still needed by hand: a METAL_PRESETS.' + metal +
      ' entry in js/three-viewer.js, and a .product-metals__option[data-metal="' + metal + '"] rule in css/style.css ' +
      "— this tool does not touch either file. Existing products won't have a \"" + metal +
      '" entry under per-metal-specs until you re-save them here, either.'
  });
}

// ---- series writes ----

async function handleSeriesEdit(req, res) {
  const body = await readJsonBody(req);
  const seriesSlug = body.seriesSlug;
  const fields = body.fields || {};
  if (!seriesSlug) return sendJson(res, 400, { error: "seriesSlug is required" });
  if (fields.slug !== undefined) {
    return sendJson(res, 400, { error: "slug cannot be changed here — it would require moving every asset path in this series" });
  }

  let text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  const seriesIndex = JSON.parse(text);
  if (!findSeriesEntry(seriesIndex, seriesSlug)) return sendJson(res, 404, { error: "unknown series: " + seriesSlug });

  const patches = [];
  if (fields.name !== undefined) patches.push(["name", '"' + blocks.esc(fields.name) + '"']);
  if (fields.year !== undefined) patches.push(["year", '"' + blocks.esc(fields.year) + '"']);
  if (fields.hdri !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(seriesIndex.hdris || {}, fields.hdri)) {
      return sendJson(res, 400, { error: "unknown hdri: " + fields.hdri });
    }
    patches.push(["hdri", '"' + blocks.esc(fields.hdri) + '"']);
  }
  if (fields.categories !== undefined) {
    const arr = Array.isArray(fields.categories) ? fields.categories : [];
    patches.push(["categories", "[" + arr.map((c) => '"' + blocks.esc(c) + '"').join(", ") + "]"]);
  }

  for (const [fieldName, valueText] of patches) {
    const patched = blocks.updateSeriesFieldInText(text, seriesSlug, fieldName, valueText);
    if (!patched) return sendJson(res, 500, { error: 'could not find "' + fieldName + '" on series "' + seriesSlug + '"' });
    text = patched;
  }

  fs.writeFileSync(SERIES_JSON_PATH, text, "utf8");
  sendJson(res, 200, { ok: true });
}

async function handleSeriesAdd(req, res) {
  const body = await readJsonBody(req);
  const slugValue = String(body.slug || "").trim();
  const name = String(body.name || "").trim();
  const year = String(body.year || "").trim();
  const categories = Array.isArray(body.categories) ? body.categories : [];
  const hdri = body.hdri || "";

  if (!/^[a-z0-9-]+$/.test(slugValue)) return sendJson(res, 400, { error: "slug must be lowercase kebab-case" });
  if (!name) return sendJson(res, 400, { error: "name is required" });
  if (!year) return sendJson(res, 400, { error: "year is required" });

  const text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  const seriesIndex = JSON.parse(text);
  if (findSeriesEntry(seriesIndex, slugValue)) return sendJson(res, 409, { error: "series already exists: " + slugValue });
  if (hdri && !Object.prototype.hasOwnProperty.call(seriesIndex.hdris || {}, hdri)) {
    return sendJson(res, 400, { error: "unknown hdri: " + hdri });
  }

  const dataDir = path.join(ROOT, "data", "series", slugValue);
  const heroDir = path.join(ROOT, "series", slugValue);
  const assetsSeriesDir = path.join(ROOT, "assets", "series", slugValue);
  if (fs.existsSync(dataDir) || fs.existsSync(heroDir) || fs.existsSync(assetsSeriesDir)) {
    return sendJson(res, 409, { error: "series folders already exist for slug: " + slugValue });
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(assetsSeriesDir, "hero"), { recursive: true });
  fs.mkdirSync(path.join(assetsSeriesDir, "products"), { recursive: true });
  fs.mkdirSync(heroDir, { recursive: true });

  const productsRelPath = "data/series/" + slugValue + "/products.json";
  const manifestRelPath = "data/series/" + slugValue + "/manifest.json";
  // Brand-new files, nothing hand-formatted here yet to preserve — a plain
  // JSON.stringify is fine (unlike every edit-in-place path above).
  fs.writeFileSync(path.join(ROOT, productsRelPath), JSON.stringify({ series: slugValue, products: [] }, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(ROOT, manifestRelPath),
    JSON.stringify({ series: slugValue, title: name, subtitle: "", year, intro: "", sections: [], credits: [] }, null, 2) + "\n",
    "utf8"
  );

  const created = [productsRelPath, manifestRelPath];
  const bonesHeroDir = path.join(ROOT, "series", "bones");
  ["hero.html", "hero.css", "hero.js"].forEach((f) => {
    const src = path.join(bonesHeroDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(heroDir, f));
      created.push("series/" + slugValue + "/" + f);
    }
  });

  const seriesBlockText = blocks.renderSeriesBlock({
    slug: slugValue,
    name,
    year,
    categories,
    products: productsRelPath,
    hdri,
    manifest: manifestRelPath,
    hero: {
      fragment: "series/" + slugValue + "/hero.html",
      css: "series/" + slugValue + "/hero.css",
      js: "series/" + slugValue + "/hero.js",
      preload: []
    }
  });
  const patched = blocks.insertBeforeArrayClose(text, '"series": [', seriesBlockText);
  if (!patched) return sendJson(res, 500, { error: 'could not find "series": [ in data/series.json' });
  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");

  sendJson(res, 200, {
    ok: true,
    slug: slugValue,
    created,
    reminders: [
      "hero.html/css/js were copied verbatim from series/bones/ — edit them by hand before this series is presentable.",
      "hero.preload was left empty — add real asset paths once hero art exists.",
      "This series' products array starts empty — use the Products tab to add its first product."
    ]
  });
}

// Deletes an entire series: its data/series/<slug>/ folder, its
// series/<slug>/ hero bundle, its assets/series/<slug>/ tree (every
// product's assets, including anything auto-render already generated
// there), and its block in data/series.json. Blocked outright rather than
// warn-and-proceed when the series is still load-bearing (currently
// featured, or the last one left) — either would leave the live site with
// no homepage series to show at all.
async function handleSeriesRemove(req, res) {
  const body = await readJsonBody(req);
  const slugValue = body.slug;
  if (!slugValue) return sendJson(res, 400, { error: "slug is required" });
  if (!isSafeSlugSegment(slugValue)) return sendJson(res, 400, { error: "unsafe slug: " + slugValue });

  const text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  const seriesIndex = JSON.parse(text);
  const entry = findSeriesEntry(seriesIndex, slugValue);
  if (!entry) return sendJson(res, 404, { error: "unknown series: " + slugValue });
  if (seriesIndex.featured === slugValue) {
    return sendJson(res, 409, { error: 'series "' + slugValue + '" is the featured series — change Featured to another series first' });
  }
  if ((seriesIndex.series || []).length <= 1) {
    return sendJson(res, 409, { error: "cannot remove the last remaining series" });
  }

  const deleted = [];
  [
    path.join(ROOT, "data", "series", slugValue),
    path.join(ROOT, "series", slugValue),
    path.join(ROOT, "assets", "series", slugValue)
  ].forEach((dir) => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      deleted.push(path.relative(ROOT, dir).replace(/\\/g, "/"));
    }
  });

  const patched = blocks.removeSeriesBlockInText(text, slugValue);
  if (!patched) return sendJson(res, 500, { error: 'could not locate series "' + slugValue + '" in data/series.json' });
  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");

  sendJson(res, 200, { ok: true, deleted });
}

// ---- product writes ----

async function handleProductAdd(req, res) {
  const body = await readJsonBody(req);
  const seriesSlug = body.seriesSlug;
  const name = String(body.name || "").trim();
  const category = body.category;
  if (!seriesSlug) return sendJson(res, 400, { error: "seriesSlug is required" });
  if (!name || !category) return sendJson(res, 400, { error: "name and category are required" });

  const seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesEntry = findSeriesEntry(seriesIndex, seriesSlug);
  if (!seriesEntry) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });
  const metals = seriesIndex.metals || [];

  const productsAbsPath = path.join(ROOT, seriesEntry.products);
  const text = fs.readFileSync(productsAbsPath, "utf8");
  const productsData = JSON.parse(text);

  const folder = productFolder(seriesSlug, name, category);
  const collision = (productsData.products || []).find((p) => productFolder(seriesSlug, p.name, p.category) === folder);
  if (collision) {
    return sendJson(res, 409, { error: 'a product already uses folder ' + folder + ' ("' + collision.name + '") — pick a different name/category' });
  }

  const assets = { model: "", icons: {}, "fallback-img": {}, xray: "", "top-shot": {}, photos: [] };
  metals.forEach((m) => {
    assets.icons[m] = "";
    assets["fallback-img"][m] = "";
    assets["top-shot"][m] = "";
  });

  const written = [];
  try {
    if (body.modelFile && body.modelFile.filename) {
      const ext = extOf(body.modelFile.filename);
      if (!MODEL_EXTS.includes(ext)) return sendJson(res, 400, { error: "model file must be .glb or .gltf" });
      const dest = folder + "/" + blocks.slug(name) + "_gltf" + ext;
      writeBase64File(dest, body.modelFile.contentBase64);
      assets.model = dest;
      written.push(dest);
    }
    if (body.xrayFile && body.xrayFile.filename) {
      const ext = extOf(body.xrayFile.filename);
      if (!IMAGE_EXTS.includes(ext)) return sendJson(res, 400, { error: "xray file must be a png/webp/jpg image" });
      const dest = folder + "/" + blocks.slug(name) + "_xray" + ext;
      writeBase64File(dest, body.xrayFile.contentBase64);
      assets.xray = dest;
      written.push(dest);
    }
    const photoFiles = Array.isArray(body.photoFiles) ? body.photoFiles : [];
    photoFiles.forEach((f, i) => {
      const ext = extOf(f.filename) || ".png";
      const dest = folder + "/" + name + "_photo" + (i + 1) + ext;
      writeBase64File(dest, f.contentBase64);
      assets.photos.push(dest);
      written.push(dest);
    });
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const product = {
    id: nextProductId(productsData),
    name,
    category,
    description: body.description || "",
    "default-metal": body.defaultMetal || metals[0] || "",
    "per-metal-specs": body.perMetalSpecs || {},
    "hero-hand-visibility": body.heroHandVisibility || { visible: false, x: 50, y: 50, scale: 6, rotation: 0 },
    "3d-viewer-camera-default": body.cameraDefault || { rotation: 0, tilt: 75, zoom: 105 },
    assets
  };

  const blockText = blocks.renderProductBlock(product, metals);
  const patched = blocks.insertBeforeArrayClose(text, '"products": [', blockText);
  if (!patched) return sendJson(res, 500, { error: 'could not find "products": [ in ' + seriesEntry.products });
  fs.writeFileSync(productsAbsPath, patched, "utf8");

  sendJson(res, 200, {
    ok: true,
    id: product.id,
    folder,
    written,
    reminder: "Run `npm run auto-render` to generate icons/fallback-img/top-shots for this product."
  });
}

async function handleProductEdit(req, res) {
  const body = await readJsonBody(req);
  const seriesSlug = body.seriesSlug;
  const productId = body.productId;
  if (!seriesSlug || !productId) return sendJson(res, 400, { error: "seriesSlug and productId are required" });

  const seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesEntry = findSeriesEntry(seriesIndex, seriesSlug);
  if (!seriesEntry) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });
  const metals = seriesIndex.metals || [];

  const productsAbsPath = path.join(ROOT, seriesEntry.products);
  const text = fs.readFileSync(productsAbsPath, "utf8");
  const productsData = JSON.parse(text);
  const current = (productsData.products || []).find((p) => String(p.id) === String(productId));
  if (!current) return sendJson(res, 404, { error: "no product with id " + productId + " in " + seriesEntry.products });

  const fields = body.fields || {};
  const nextName = fields.name !== undefined ? String(fields.name).trim() : current.name;
  const nextCategory = fields.category !== undefined ? fields.category : current.category;
  if (!nextName || !nextCategory) return sendJson(res, 400, { error: "name and category cannot be empty" });

  const oldFolder = productFolder(seriesSlug, current.name, current.category);
  const newFolder = productFolder(seriesSlug, nextName, nextCategory);
  const collision = (productsData.products || []).find(
    (p) => String(p.id) !== String(productId) && productFolder(seriesSlug, p.name, p.category) === newFolder
  );
  if (collision) {
    return sendJson(res, 409, { error: 'a different product already uses folder ' + newFolder + ' ("' + collision.name + '")' });
  }

  // Never renders from `fields` alone — merge onto the CURRENT parsed
  // product first, so any field the form didn't touch (most importantly
  // assets.icons/fallback-img/top-shot, which this tool never edits at
  // all) survives untouched into the re-rendered block.
  const merged = Object.assign({}, current, { name: nextName, category: nextCategory });
  if (fields.description !== undefined) merged.description = fields.description;
  if (fields.defaultMetal !== undefined) merged["default-metal"] = fields.defaultMetal;
  if (fields.perMetalSpecs !== undefined) merged["per-metal-specs"] = fields.perMetalSpecs;
  if (fields.heroHandVisibility !== undefined) merged["hero-hand-visibility"] = fields.heroHandVisibility;
  if (fields.cameraDefault !== undefined) merged["3d-viewer-camera-default"] = fields.cameraDefault;
  merged.assets = Object.assign({}, current.assets);

  const moved = [];
  const warnings = [];
  if (oldFolder !== newFolder) {
    ["model", "xray"].forEach((key) => {
      const oldRel = merged.assets[key];
      if (oldRel) {
        const newRel = newFolder + "/" + path.basename(oldRel);
        moveAssetFile(oldRel, newRel, moved, warnings);
        merged.assets[key] = newRel;
      }
    });
    merged.assets.photos = (merged.assets.photos || []).map((p) => {
      const newRel = newFolder + "/" + path.basename(p);
      moveAssetFile(p, newRel, moved, warnings);
      return newRel;
    });
    warnings.push(
      "folder changed from " + oldFolder + " to " + newFolder +
      " — run `npm run auto-render` to regenerate icons/fallback-img/top-shots there; stale renders were left behind in the old folder."
    );
  }

  const written = [];
  try {
    if (body.modelFile && body.modelFile.filename) {
      const ext = extOf(body.modelFile.filename);
      if (!MODEL_EXTS.includes(ext)) return sendJson(res, 400, { error: "model file must be .glb or .gltf" });
      const dest = newFolder + "/" + blocks.slug(nextName) + "_gltf" + ext;
      writeBase64File(dest, body.modelFile.contentBase64);
      merged.assets.model = dest;
      written.push(dest);
    }
    if (body.xrayFile && body.xrayFile.filename) {
      const ext = extOf(body.xrayFile.filename);
      if (!IMAGE_EXTS.includes(ext)) return sendJson(res, 400, { error: "xray file must be a png/webp/jpg image" });
      const dest = newFolder + "/" + blocks.slug(nextName) + "_xray" + ext;
      writeBase64File(dest, body.xrayFile.contentBase64);
      merged.assets.xray = dest;
      written.push(dest);
    }
    const photoFiles = Array.isArray(body.photoFiles) ? body.photoFiles : [];
    let photoIndex = (merged.assets.photos || []).length;
    photoFiles.forEach((f) => {
      photoIndex += 1;
      const ext = extOf(f.filename) || ".png";
      const dest = newFolder + "/" + nextName + "_photo" + photoIndex + ext;
      writeBase64File(dest, f.contentBase64);
      merged.assets.photos.push(dest);
      written.push(dest);
    });
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  const blockText = blocks.renderProductBlock(merged, metals);
  const patched = blocks.replaceProductBlockInText(text, productId, blockText);
  if (!patched) return sendJson(res, 500, { error: "could not locate product " + productId + " in " + seriesEntry.products });
  fs.writeFileSync(productsAbsPath, patched, "utf8");

  sendJson(res, 200, { ok: true, folder: newFolder, moved, written, warnings });
}

// Deletes one product entirely: its whole asset folder (model, xray,
// photos, and anything auto-render already generated there) and its block
// in that series' products.json. Nothing else in the data model points AT
// a product (unlike a series, which "featured" can point to), so there's
// no analogous blocking check here beyond the product existing at all.
async function handleProductRemove(req, res) {
  const body = await readJsonBody(req);
  const seriesSlug = body.seriesSlug;
  const productId = body.productId;
  if (!seriesSlug || !productId) return sendJson(res, 400, { error: "seriesSlug and productId are required" });

  const seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesEntry = findSeriesEntry(seriesIndex, seriesSlug);
  if (!seriesEntry) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });

  const productsAbsPath = path.join(ROOT, seriesEntry.products);
  const text = fs.readFileSync(productsAbsPath, "utf8");
  const productsData = JSON.parse(text);
  const current = (productsData.products || []).find((p) => String(p.id) === String(productId));
  if (!current) return sendJson(res, 404, { error: "no product with id " + productId });

  const folder = productFolder(seriesSlug, current.name, current.category);
  if (!PRODUCT_ASSET_FOLDER_RE.test(folder)) {
    return sendJson(res, 400, { error: "unsafe product folder, refusing to delete: " + folder });
  }

  const absFolder = path.join(ROOT, folder);
  let deletedFolder = false;
  if (fs.existsSync(absFolder)) {
    fs.rmSync(absFolder, { recursive: true, force: true });
    deletedFolder = true;
  }

  const patched = blocks.removeProductBlockInText(text, productId);
  if (!patched) return sendJson(res, 500, { error: "could not locate product " + productId });
  fs.writeFileSync(productsAbsPath, patched, "utf8");

  sendJson(res, 200, { ok: true, deleted: deletedFolder ? [folder] : [] });
}

async function handleProductRemovePhoto(req, res) {
  const body = await readJsonBody(req);
  const seriesSlug = body.seriesSlug;
  const productId = body.productId;
  const photoPath = body.photoPath;
  if (!seriesSlug || !productId || !photoPath) {
    return sendJson(res, 400, { error: "seriesSlug, productId and photoPath are required" });
  }

  const seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesEntry = findSeriesEntry(seriesIndex, seriesSlug);
  if (!seriesEntry) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });
  const metals = seriesIndex.metals || [];

  const productsAbsPath = path.join(ROOT, seriesEntry.products);
  const text = fs.readFileSync(productsAbsPath, "utf8");
  const productsData = JSON.parse(text);
  const current = (productsData.products || []).find((p) => String(p.id) === String(productId));
  if (!current) return sendJson(res, 404, { error: "no product with id " + productId });

  const existingPhotos = (current.assets && current.assets.photos) || [];
  if (!existingPhotos.includes(photoPath)) return sendJson(res, 400, { error: "photo not found on this product: " + photoPath });

  const merged = Object.assign({}, current);
  merged.assets = Object.assign({}, current.assets, { photos: existingPhotos.filter((p) => p !== photoPath) });

  const absPath = path.join(ROOT, photoPath);
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);

  const blockText = blocks.renderProductBlock(merged, metals);
  const patched = blocks.replaceProductBlockInText(text, productId, blockText);
  if (!patched) return sendJson(res, 500, { error: "could not locate product " + productId });
  fs.writeFileSync(productsAbsPath, patched, "utf8");

  sendJson(res, 200, { ok: true });
}

// Immediate (not deferred to the big Save button) replace/remove for the
// two single-file hand-owned assets (model, xray) — the UI only ever shows
// these next to an ALREADY-SAVED file, unlike the dropzones (which stage a
// pending upload for Save, used when the slot is still empty/in Add mode).
// Both re-read+re-render the whole product block, same pattern as
// handleProductRemovePhoto above.

async function handleProductReplaceAsset(req, res) {
  const body = await readJsonBody(req);
  const seriesSlug = body.seriesSlug;
  const productId = body.productId;
  const assetKey = body.assetKey;
  if (!seriesSlug || !productId) return sendJson(res, 400, { error: "seriesSlug and productId are required" });
  if (assetKey !== "model" && assetKey !== "xray") return sendJson(res, 400, { error: 'assetKey must be "model" or "xray"' });
  if (!body.filename || !body.contentBase64) return sendJson(res, 400, { error: "filename and contentBase64 are required" });

  const seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesEntry = findSeriesEntry(seriesIndex, seriesSlug);
  if (!seriesEntry) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });
  const metals = seriesIndex.metals || [];

  const productsAbsPath = path.join(ROOT, seriesEntry.products);
  const text = fs.readFileSync(productsAbsPath, "utf8");
  const productsData = JSON.parse(text);
  const current = (productsData.products || []).find((p) => String(p.id) === String(productId));
  if (!current) return sendJson(res, 404, { error: "no product with id " + productId });

  const ext = extOf(body.filename);
  if (assetKey === "model" && !MODEL_EXTS.includes(ext)) return sendJson(res, 400, { error: "model file must be .glb or .gltf" });
  if (assetKey === "xray" && !IMAGE_EXTS.includes(ext)) return sendJson(res, 400, { error: "xray file must be a png/webp/jpg image" });

  const folder = productFolder(seriesSlug, current.name, current.category);
  const suffix = assetKey === "model" ? "_gltf" : "_xray";
  const dest = folder + "/" + blocks.slug(current.name) + suffix + ext;

  try {
    writeBase64File(dest, body.contentBase64);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  const oldRel = current.assets && current.assets[assetKey];
  if (oldRel && oldRel !== dest) {
    const oldAbs = path.join(ROOT, oldRel);
    if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
  }

  const merged = Object.assign({}, current);
  merged.assets = Object.assign({}, current.assets);
  merged.assets[assetKey] = dest;

  const blockText = blocks.renderProductBlock(merged, metals);
  const patched = blocks.replaceProductBlockInText(text, productId, blockText);
  if (!patched) return sendJson(res, 500, { error: "could not locate product " + productId });
  fs.writeFileSync(productsAbsPath, patched, "utf8");

  sendJson(res, 200, { ok: true, path: dest });
}

async function handleProductRemoveAsset(req, res) {
  const body = await readJsonBody(req);
  const seriesSlug = body.seriesSlug;
  const productId = body.productId;
  const assetKey = body.assetKey;
  if (!seriesSlug || !productId) return sendJson(res, 400, { error: "seriesSlug and productId are required" });
  if (assetKey !== "model" && assetKey !== "xray") return sendJson(res, 400, { error: 'assetKey must be "model" or "xray"' });

  const seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesEntry = findSeriesEntry(seriesIndex, seriesSlug);
  if (!seriesEntry) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });
  const metals = seriesIndex.metals || [];

  const productsAbsPath = path.join(ROOT, seriesEntry.products);
  const text = fs.readFileSync(productsAbsPath, "utf8");
  const productsData = JSON.parse(text);
  const current = (productsData.products || []).find((p) => String(p.id) === String(productId));
  if (!current) return sendJson(res, 404, { error: "no product with id " + productId });

  const oldRel = current.assets && current.assets[assetKey];
  if (oldRel) {
    const oldAbs = path.join(ROOT, oldRel);
    if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
  }

  const merged = Object.assign({}, current);
  merged.assets = Object.assign({}, current.assets);
  merged.assets[assetKey] = "";

  const blockText = blocks.renderProductBlock(merged, metals);
  const patched = blocks.replaceProductBlockInText(text, productId, blockText);
  if (!patched) return sendJson(res, 500, { error: "could not locate product " + productId });
  fs.writeFileSync(productsAbsPath, patched, "utf8");

  sendJson(res, 200, { ok: true });
}

// Immediate positional replace for one already-existing photo — keeps the
// same array index (so it isn't just "remove + append", which would
// reorder the carousel), renaming to match the new file's own extension.
async function handleProductReplacePhoto(req, res) {
  const body = await readJsonBody(req);
  const seriesSlug = body.seriesSlug;
  const productId = body.productId;
  const oldPhotoPath = body.oldPhotoPath;
  if (!seriesSlug || !productId || !oldPhotoPath) {
    return sendJson(res, 400, { error: "seriesSlug, productId and oldPhotoPath are required" });
  }
  if (!body.filename || !body.contentBase64) return sendJson(res, 400, { error: "filename and contentBase64 are required" });

  const seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  const seriesEntry = findSeriesEntry(seriesIndex, seriesSlug);
  if (!seriesEntry) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });
  const metals = seriesIndex.metals || [];

  const productsAbsPath = path.join(ROOT, seriesEntry.products);
  const text = fs.readFileSync(productsAbsPath, "utf8");
  const productsData = JSON.parse(text);
  const current = (productsData.products || []).find((p) => String(p.id) === String(productId));
  if (!current) return sendJson(res, 404, { error: "no product with id " + productId });

  const photos = (current.assets && current.assets.photos) || [];
  const index = photos.indexOf(oldPhotoPath);
  if (index === -1) return sendJson(res, 400, { error: "photo not found on this product: " + oldPhotoPath });

  const ext = extOf(body.filename) || ".png";
  if (!IMAGE_EXTS.includes(ext)) return sendJson(res, 400, { error: "photo file must be a png/webp/jpg image" });

  const folder = productFolder(seriesSlug, current.name, current.category);
  const dest = folder + "/" + current.name + "_photo" + (index + 1) + ext;

  try {
    writeBase64File(dest, body.contentBase64);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  if (oldPhotoPath !== dest) {
    const oldAbs = path.join(ROOT, oldPhotoPath);
    if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
  }

  const merged = Object.assign({}, current);
  merged.assets = Object.assign({}, current.assets);
  merged.assets.photos = photos.slice();
  merged.assets.photos[index] = dest;

  const blockText = blocks.renderProductBlock(merged, metals);
  const patched = blocks.replaceProductBlockInText(text, productId, blockText);
  if (!patched) return sendJson(res, 500, { error: "could not locate product " + productId });
  fs.writeFileSync(productsAbsPath, patched, "utf8");

  sendJson(res, 200, { ok: true, path: dest });
}

// ---- generic file primitives ----

async function handleSaveFile(req, res) {
  const body = await readJsonBody(req);
  try {
    writeBase64File(body.destPath, body.contentBase64);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  sendJson(res, 200, { ok: true, path: body.destPath });
}

async function handleDeleteFile(req, res) {
  const body = await readJsonBody(req);
  if (!isAllowedAssetDestPath(body.path)) return sendJson(res, 400, { error: "path not allowed: " + body.path });
  const absPath = path.join(ROOT, body.path);
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  sendJson(res, 200, { ok: true });
}

const ROUTES = {
  "GET /api/data": handleGetData,
  "POST /api/global/featured": handleGlobalFeatured,
  "POST /api/global/category": handleGlobalCategory,
  "POST /api/global/hdri": handleGlobalHdri,
  "POST /api/global/metal": handleGlobalMetal,
  "POST /api/series/edit": handleSeriesEdit,
  "POST /api/series/add": handleSeriesAdd,
  "POST /api/series/remove": handleSeriesRemove,
  "POST /api/product/add": handleProductAdd,
  "POST /api/product/edit": handleProductEdit,
  "POST /api/product/remove": handleProductRemove,
  "POST /api/product/remove-photo": handleProductRemovePhoto,
  "POST /api/product/replace-asset": handleProductReplaceAsset,
  "POST /api/product/remove-asset": handleProductRemoveAsset,
  "POST /api/product/replace-photo": handleProductReplacePhoto,
  "POST /api/save-file": handleSaveFile,
  "POST /api/delete-file": handleDeleteFile
};

// ---- static file serving — same shape as scripts/scene-tool-server.js's
// own serveStatic. ----
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/json-tool.html";
  const filePath = path.join(ROOT, urlPath);
  const normalizedFile = path.resolve(filePath).replace(/\\/g, "/").toLowerCase();
  const normalizedRoot = path.resolve(ROOT).replace(/\\/g, "/").toLowerCase();
  if (!normalizedFile.startsWith(normalizedRoot)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found: " + urlPath);
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const routeKey = req.method + " " + req.url.split("?")[0];
  const handler = ROUTES[routeKey];
  if (handler) {
    handler(req, res).catch((err) => {
      console.error(err);
      sendJson(res, 500, { error: String((err && err.message) || err) });
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log("json-tool — http://localhost:" + PORT + "/json-tool.html");
});
