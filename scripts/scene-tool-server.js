#!/usr/bin/env node
/* ==========================================================================
   scene-tool-server — bare static/API server for scene-tool.html, a
   standalone dev page for tuning a product's camera angle, a series'/the
   swatch renderer's HDRI, the swatch-scene primitive+camera, and a metal's
   shader — all as a live preview through the site's real
   window.EmjiveModelViewer (js/three-viewer.js), with a Save action that
   text-patches the relevant source file in place.

   Usage:
     node scripts/scene-tool-server.js
     npm run scene-tool

   Modeled directly on scripts/auto-render.js's own startServer()/MIME map/
   path-traversal guard (duplicated rather than imported — this file has no
   other reason to depend on auto-render.js, and a little redundancy here
   is consistent with this repo's own tolerance for that trade-off, e.g.
   vite.config.js's copyFilesVitesBuildCantTrace() comment).

   Deliberately outside Vite entirely (not in vite.config.js's
   rollupOptions.input, same as auto-render.js itself) — this is an
   authoring tool, not a page the live site ever serves.
   ========================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const SERIES_JSON_PATH = path.join(ROOT, "data", "series.json");
const THREE_VIEWER_PATH = path.join(ROOT, "js", "three-viewer.js");
const PORT = 5200;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".hdr": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".css": "text/css"
};

const KNOWN_PRIMITIVES = ["cylinder", "box", "sphere", "torus"];

// ---- small shared helpers ----

function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    var chunks = [];
    var size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
        req.destroy();
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      var raw = Buffer.concat(chunks).toString("utf8");
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
  var body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function findSeriesEntry(seriesIndex, seriesSlug) {
  return (seriesIndex.series || []).find((s) => s.slug === seriesSlug) || null;
}

// ---- text-surgery patchers — same "id"/"slug"-anchor, non-nested-braces
// block-scoping idiom as scripts/auto-render.js's own
// updateProductMetalFieldInText, adapted for whole-block numeric/string
// replacements instead of a per-metal string value swap. Never re-parses/
// re-serializes the whole file, so hand-aligned formatting elsewhere
// survives untouched. Each returns the patched text, or null if the
// expected shape wasn't found (caller responds with a clear error rather
// than silently inserting a new key). ----

function updateCameraDefaultInText(text, productId, orbit) {
  var idAnchor = '"id": "' + productId + '"';
  var startIdx = text.indexOf(idAnchor);
  if (startIdx === -1) return null;
  var nextIdIdx = text.indexOf('"id": "', startIdx + idAnchor.length);
  var blockEnd = nextIdIdx === -1 ? text.length : nextIdIdx;
  var block = text.slice(startIdx, blockEnd);

  var fieldPattern = /"3d-viewer-camera-default":\s*\{[^}]*\}/;
  if (!fieldPattern.test(block)) return null;
  var newFieldText =
    '"3d-viewer-camera-default": { "rotation": ' + orbit.rotation +
    ', "tilt": ' + orbit.tilt + ', "zoom": ' + orbit.zoom + ' }';
  var newBlock = block.replace(fieldPattern, newFieldText);
  return text.slice(0, startIdx) + newBlock + text.slice(blockEnd);
}

function updateSeriesHdriInText(text, seriesSlug, hdriKey) {
  var slugAnchor = '"slug": "' + seriesSlug + '"';
  var startIdx = text.indexOf(slugAnchor);
  if (startIdx === -1) return null;
  var nextSlugIdx = text.indexOf('"slug": "', startIdx + slugAnchor.length);
  var blockEnd = nextSlugIdx === -1 ? text.length : nextSlugIdx;
  var block = text.slice(startIdx, blockEnd);

  var fieldPattern = /"hdri":\s*"[^"]*"/;
  if (!fieldPattern.test(block)) return null;
  var newBlock = block.replace(fieldPattern, '"hdri": "' + hdriKey + '"');
  return text.slice(0, startIdx) + newBlock + text.slice(blockEnd);
}

// Top-level fields only ("swatch-primitive"/"swatch-hdri"/"swatch-camera"),
// no id/slug-anchoring needed — each is a single, unique key in
// data/series.json. `updates` may carry any subset of the three; only the
// keys present get patched, applied to the same text in sequence. Returns
// null (without writing anything from `updates` at all) if ANY requested
// key's field isn't found, so a partial patch never lands silently.
function updateSwatchSceneInText(text, updates) {
  var result = text;
  if (updates["swatch-primitive"] !== undefined) {
    var primitivePattern = /"swatch-primitive":\s*"[^"]*"/;
    if (!primitivePattern.test(result)) return null;
    result = result.replace(primitivePattern, '"swatch-primitive": "' + updates["swatch-primitive"] + '"');
  }
  if (updates["swatch-hdri"] !== undefined) {
    var hdriPattern = /"swatch-hdri":\s*"[^"]*"/;
    if (!hdriPattern.test(result)) return null;
    result = result.replace(hdriPattern, '"swatch-hdri": "' + updates["swatch-hdri"] + '"');
  }
  if (updates["swatch-camera"] !== undefined) {
    var cameraPattern = /"swatch-camera":\s*\{[^}]*\}/;
    if (!cameraPattern.test(result)) return null;
    var c = updates["swatch-camera"];
    var newCameraText =
      '"swatch-camera": { "rotation": ' + c.rotation + ', "tilt": ' + c.tilt + ', "zoom": ' + c.zoom + ' }';
    result = result.replace(cameraPattern, newCameraText);
  }
  return result;
}

// Patches js/three-viewer.js's own METAL_PRESETS object — the one save
// target in this file that isn't JSON. Bounded to the object literal's own
// span first ("var METAL_PRESETS = {" to the first "};" after it — a
// small, flat, 3-entry object, safe to bound this way) before matching the
// one metal's own sub-block within it, so a coincidental "steel:"/etc
// elsewhere in the file (there isn't one today, but this is cheap
// insurance) can never be touched. Regenerates the whole metal line in the
// file's existing "N / 255" style for baseColorFactor.
function updateMetalPresetInText(text, metalKey, preset) {
  var startAnchor = "var METAL_PRESETS = {";
  var startIdx = text.indexOf(startAnchor);
  if (startIdx === -1) return null;
  var blockEndIdx = text.indexOf("};", startIdx);
  if (blockEndIdx === -1) return null;
  var blockEnd = blockEndIdx + 2;
  var block = text.slice(startIdx, blockEnd);

  var fieldPattern = new RegExp(metalKey + ":\\s*\\{[^}]*\\}");
  if (!fieldPattern.test(block)) return null;
  var newFieldText =
    metalKey + ": { baseColorFactor: [" + preset.r + " / 255, " + preset.g + " / 255, " + preset.b +
    " / 255, 1], metallicFactor: " + preset.metallicFactor + ", roughnessFactor: " + preset.roughnessFactor + " }";
  var newBlock = block.replace(fieldPattern, newFieldText);
  return text.slice(0, startIdx) + newBlock + text.slice(blockEnd);
}

// ---- endpoint handlers — each re-reads its target file fresh (this
// server is long-lived across many separate Save clicks, unlike
// auto-render.js's one-shot batch read), validates before touching disk,
// and writes only on a successful patch match. ----

async function handleSaveProductCamera(req, res) {
  var body = await readJsonBody(req);
  var seriesSlug = body.seriesSlug;
  var productId = body.productId;
  if (!seriesSlug || !productId) return sendJson(res, 400, { error: "seriesSlug and productId are required" });
  if (![body.rotation, body.tilt, body.zoom].every(isFiniteNumber)) {
    return sendJson(res, 400, { error: "rotation/tilt/zoom must be finite numbers" });
  }

  var seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  var seriesEntry = findSeriesEntry(seriesIndex, seriesSlug);
  if (!seriesEntry) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });

  var productsPath = path.join(ROOT, seriesEntry.products);
  var text = fs.readFileSync(productsPath, "utf8");
  var orbit = { rotation: Math.round(body.rotation), tilt: Math.round(body.tilt), zoom: Math.round(body.zoom) };
  var patched = updateCameraDefaultInText(text, productId, orbit);
  if (!patched) {
    return sendJson(res, 404, {
      error: "could not find \"" + productId + "\"'s 3d-viewer-camera-default field in " +
        seriesEntry.products + " — add it by hand first"
    });
  }

  fs.writeFileSync(productsPath, patched, "utf8");
  return sendJson(res, 200, { ok: true, saved: orbit });
}

async function handleSaveSeriesHdri(req, res) {
  var body = await readJsonBody(req);
  var seriesSlug = body.seriesSlug;
  var hdriKey = body.hdriKey;
  if (!seriesSlug || !hdriKey) return sendJson(res, 400, { error: "seriesSlug and hdriKey are required" });

  var seriesText = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  var seriesIndex = JSON.parse(seriesText);
  if (!findSeriesEntry(seriesIndex, seriesSlug)) return sendJson(res, 400, { error: "unknown series: " + seriesSlug });
  if (!Object.prototype.hasOwnProperty.call(seriesIndex.hdris || {}, hdriKey)) {
    return sendJson(res, 400, { error: "unknown hdri: " + hdriKey });
  }

  var patched = updateSeriesHdriInText(seriesText, seriesSlug, hdriKey);
  if (!patched) {
    return sendJson(res, 404, { error: "could not find series \"" + seriesSlug + "\"'s hdri field — add it by hand first" });
  }

  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");
  return sendJson(res, 200, { ok: true, saved: { seriesSlug: seriesSlug, hdri: hdriKey } });
}

async function handleSaveSwatchCamera(req, res) {
  var body = await readJsonBody(req);
  var primitive = body.primitive;
  if (!KNOWN_PRIMITIVES.includes(primitive)) {
    return sendJson(res, 400, { error: "primitive must be one of: " + KNOWN_PRIMITIVES.join(", ") });
  }
  if (![body.rotation, body.tilt, body.zoom].every(isFiniteNumber)) {
    return sendJson(res, 400, { error: "rotation/tilt/zoom must be finite numbers" });
  }

  var text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  var camera = { rotation: Math.round(body.rotation), tilt: Math.round(body.tilt), zoom: Math.round(body.zoom) };
  var patched = updateSwatchSceneInText(text, { "swatch-primitive": primitive, "swatch-camera": camera });
  if (!patched) {
    return sendJson(res, 404, { error: "could not find \"swatch-primitive\"/\"swatch-camera\" in data/series.json — add them by hand first" });
  }

  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");
  return sendJson(res, 200, { ok: true, saved: { "swatch-primitive": primitive, "swatch-camera": camera } });
}

async function handleSaveSwatchHdri(req, res) {
  var body = await readJsonBody(req);
  var hdriKey = body.hdriKey;
  if (!hdriKey) return sendJson(res, 400, { error: "hdriKey is required" });

  var text = fs.readFileSync(SERIES_JSON_PATH, "utf8");
  var seriesIndex = JSON.parse(text);
  if (!Object.prototype.hasOwnProperty.call(seriesIndex.hdris || {}, hdriKey)) {
    return sendJson(res, 400, { error: "unknown hdri: " + hdriKey });
  }

  var patched = updateSwatchSceneInText(text, { "swatch-hdri": hdriKey });
  if (!patched) {
    return sendJson(res, 404, { error: "could not find \"swatch-hdri\" in data/series.json — add it by hand first" });
  }

  fs.writeFileSync(SERIES_JSON_PATH, patched, "utf8");
  return sendJson(res, 200, { ok: true, saved: { "swatch-hdri": hdriKey } });
}

async function handleSaveMetalShader(req, res) {
  var body = await readJsonBody(req);
  var metalKey = body.metalKey;

  var seriesIndex = JSON.parse(fs.readFileSync(SERIES_JSON_PATH, "utf8"));
  if (!(seriesIndex.metals || []).includes(metalKey)) {
    return sendJson(res, 400, { error: "unknown metal: " + metalKey });
  }
  var r = body.r, g = body.g, b = body.b;
  var metallicFactor = body.metallicFactor, roughnessFactor = body.roughnessFactor;
  if (![r, g, b].every(isFiniteNumber) || [r, g, b].some((n) => n < 0 || n > 255)) {
    return sendJson(res, 400, { error: "r/g/b must be finite numbers between 0 and 255" });
  }
  if (![metallicFactor, roughnessFactor].every(isFiniteNumber) || [metallicFactor, roughnessFactor].some((n) => n < 0 || n > 1)) {
    return sendJson(res, 400, { error: "metallicFactor/roughnessFactor must be finite numbers between 0 and 1" });
  }

  var text = fs.readFileSync(THREE_VIEWER_PATH, "utf8");
  var preset = {
    r: Math.round(r), g: Math.round(g), b: Math.round(b),
    metallicFactor: metallicFactor, roughnessFactor: roughnessFactor
  };
  var patched = updateMetalPresetInText(text, metalKey, preset);
  if (!patched) {
    return sendJson(res, 404, { error: "could not find METAL_PRESETS." + metalKey + " in js/three-viewer.js" });
  }

  fs.writeFileSync(THREE_VIEWER_PATH, patched, "utf8");
  return sendJson(res, 200, { ok: true, saved: { metalKey: metalKey, preset: preset } });
}

const ROUTES = {
  "POST /api/save-product-camera": handleSaveProductCamera,
  "POST /api/save-series-hdri": handleSaveSeriesHdri,
  "POST /api/save-swatch-camera": handleSaveSwatchCamera,
  "POST /api/save-swatch-hdri": handleSaveSwatchHdri,
  "POST /api/save-metal-shader": handleSaveMetalShader
};

// ---- static file serving — same shape as scripts/auto-render.js's own
// startServer(), including /node_modules/... so scene-tool.html's import
// map (three/three-addons, resolved the same way auto-render.js's
// HARNESS_HTML does) can be served from this same bare server. ----
function serveStatic(req, res) {
  var urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/scene-tool.html";
  var filePath = path.join(ROOT, urlPath);
  var normalizedFile = path.resolve(filePath).replace(/\\/g, "/").toLowerCase();
  var normalizedRoot = path.resolve(ROOT).replace(/\\/g, "/").toLowerCase();
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
  var routeKey = req.method + " " + req.url.split("?")[0];
  var handler = ROUTES[routeKey];
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
  console.log("scene-tool — http://localhost:" + PORT + "/scene-tool.html");
});
