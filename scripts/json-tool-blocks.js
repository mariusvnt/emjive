#!/usr/bin/env node
/* ==========================================================================
   json-tool-blocks — pure string-rendering / JSON-text-surgery helpers for
   scripts/json-tool-server.js. No fs/http here on purpose: every function
   takes text/objects in and returns text out, so its output can be
   sanity-checked by eyeballing it against real file content without
   touching disk.

   Two families of helper live here:
   - insertBeforeArrayClose / insertBeforeObjectClose / appendToInlineStringArray
     — genuinely new primitives this tool needs that scripts/scene-tool-server.js
     and scripts/auto-render.js never did: growing a JSON collection
     (products[], series[], categories{}, hdris{}, metals[]), not just
     replacing a value that's already there. Bracket-depth counting is
     string-aware (a literal "]"/"}" inside a quoted value can't miscount).
   - renderProductBlock / renderSeriesBlock — full-block renderers used for
     BOTH adding and editing a product (and for adding a series), so the
     two code paths can never drift into producing different formatting.
     Field order/shape mirrors the real hand-authored files exactly (see
     data/series/bones/products.json's Furcula entry and data/series.json's
     bones entry). renderProductBlock deliberately never accepts
     icons/fallback-img/top-shot from its caller's own input — those three
     per-metal maps are always copied straight from the product object
     passed in, which json-tool-server.js only ever builds from the CURRENT
     on-disk product (plus whatever hand-owned fields the form changed) —
     so there is no code path in this tool that can write into an
     auto-render-owned field, even by accident.

   The rest of this repo's hand-aligned JSON columns are NOT byte-for-byte
   consistent to begin with (e.g. data/series/bones/products.json's Furcula
   entry has extra alignment spaces its own Silver/Bronze rows don't; its
   Marrow entry's top-shot block is collapsed to one line while every other
   product's is multi-line) — so this file targets clean, consistent,
   canonical spacing rather than chasing an exact reproduction of the
   source's own inconsistencies.
   ========================================================================== */

"use strict";

function esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n");
}

function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function bool(b) {
  return !!b;
}

function slug(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, "-");
}

// ---- bracket-depth scanning — shared by every insertion/lookup primitive
// below. Starts at depth 1 (the caller has already consumed the opening
// bracket as part of its anchor string) and walks forward, skipping over
// quoted string contents (so a literal "]"/"}"/`"` inside a JSON string
// value can never be mistaken for real structure), until depth returns to
// 0. Returns the index of the matching close character, or -1. ----
function findMatchingClose(text, afterOpenIdx, openChar, closeChar) {
  let i = afterOpenIdx;
  let depth = 1;
  let inString = false;
  let escaped = false;
  while (depth > 0 && i < text.length) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
    }
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

// Inserts `newEntryText` (a fully-formed, already-indented array element —
// e.g. one product block starting with its own "    {") as the new last
// element of the array opened by `openAnchor` (e.g. '"products": ['),
// adding a leading comma unless the array was empty. Returns the patched
// text, or null if `openAnchor` isn't found or its brackets don't balance.
function insertBeforeArrayClose(text, openAnchor, newEntryText) {
  const startIdx = text.indexOf(openAnchor);
  if (startIdx === -1) return null;
  const afterOpen = startIdx + openAnchor.length;
  const closeIdx = findMatchingClose(text, afterOpen, "[", "]");
  if (closeIdx === -1) return null;
  const inner = text.slice(afterOpen, closeIdx);
  const isEmpty = /^\s*$/.test(inner);
  const trimmedInner = inner.replace(/\s+$/, "");
  const insertion = isEmpty
    ? "\n" + newEntryText + "\n  "
    : trimmedInner + ",\n" + newEntryText + "\n  ";
  return text.slice(0, afterOpen) + insertion + text.slice(closeIdx);
}

// Same shape as insertBeforeArrayClose but for an object opened by
// `openAnchor` (e.g. '"categories": {') — used to add a brand-new key to
// categories{}/hdris{}, where `newEntryText` is one already-indented
// `"key": value` line.
function insertBeforeObjectClose(text, openAnchor, newEntryText) {
  const startIdx = text.indexOf(openAnchor);
  if (startIdx === -1) return null;
  const afterOpen = startIdx + openAnchor.length;
  const closeIdx = findMatchingClose(text, afterOpen, "{", "}");
  if (closeIdx === -1) return null;
  const inner = text.slice(afterOpen, closeIdx);
  const isEmpty = /^\s*$/.test(inner);
  const trimmedInner = inner.replace(/\s+$/, "");
  const insertion = isEmpty
    ? "\n" + newEntryText + "\n  "
    : trimmedInner + ",\n" + newEntryText + "\n  ";
  return text.slice(0, afterOpen) + insertion + text.slice(closeIdx);
}

// data/series.json's "metals" array is hand-written on a single line
// (`"metals": ["steel", "silver", "bronze"]`) — appending inline keeps that
// style instead of blowing it out into one-entry-per-line like the
// (already multi-line) categories/hdris objects.
function appendToInlineStringArray(text, openAnchor, value) {
  const startIdx = text.indexOf(openAnchor);
  if (startIdx === -1) return null;
  const afterOpen = startIdx + openAnchor.length;
  const closeIdx = findMatchingClose(text, afterOpen, "[", "]");
  if (closeIdx === -1) return null;
  const inner = text.slice(afterOpen, closeIdx);
  const isEmpty = /^\s*$/.test(inner);
  const trimmed = inner.replace(/\s+$/, "");
  const insertion = isEmpty ? '"' + esc(value) + '"' : trimmed + ', "' + esc(value) + '"';
  return text.slice(0, afterOpen) + insertion + text.slice(closeIdx);
}

// Patches a single already-existing top-level scalar string field (only
// "featured" today, but written generically) — same one-line non-nested
// idiom scripts/scene-tool-server.js's own patchers use.
function updateTopLevelScalarInText(text, fieldName, newValueText) {
  const fieldPattern = new RegExp('"' + fieldName + '":\\s*"[^"]*"');
  if (!fieldPattern.test(text)) return null;
  return text.replace(fieldPattern, '"' + fieldName + '": ' + newValueText);
}

// Splits an object's inner text (between its braces, NOT including them)
// into one string per top-level `"key": value` entry, by scanning for
// commas at depth 0 (string-aware, same idiom as findMatchingClose) — so a
// comma inside a nested {}/[] or a quoted string can't be mistaken for an
// entry separator. Used by removeObjectEntryInText to reconstruct the
// object body with one entry excised, without needing to know that
// entry's own value shape up front (categories' nested `{...}` vs hdris'
// plain `"..."`).
function splitTopLevelEntries(inner) {
  const entries = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") { depth++; continue; }
    if (ch === "}" || ch === "]") { depth--; continue; }
    if (ch === "," && depth === 0) {
      entries.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(inner.slice(start));
  return entries.map((e) => e.trim()).filter(Boolean);
}

// Removes an existing `"key": value` entry from a flat object opened by
// `openAnchor` (categories{}/hdris{}) — the "remove" counterpart to
// insertBeforeObjectClose's "add"/updateObjectEntryInText's "edit".
// Reconstructs the object body from its surviving entries (canonical
// spacing, same as insertBeforeObjectClose) rather than trying to patch
// around the removed entry's own comma in place. Returns null if the key
// isn't found.
function removeObjectEntryInText(text, openAnchor, key) {
  const startIdx = text.indexOf(openAnchor);
  if (startIdx === -1) return null;
  const afterOpen = startIdx + openAnchor.length;
  const closeIdx = findMatchingClose(text, afterOpen, "{", "}");
  if (closeIdx === -1) return null;
  const inner = text.slice(afterOpen, closeIdx);
  const entries = splitTopLevelEntries(inner);
  const keyPrefix = '"' + key + '":';
  const filtered = entries.filter((e) => !e.startsWith(keyPrefix));
  if (filtered.length === entries.length) return null;
  const newInner = filtered.length ? "\n    " + filtered.join(",\n    ") + "\n  " : "";
  return text.slice(0, afterOpen) + newInner + text.slice(closeIdx);
}

// Removes one value from an inline single-line string array (only
// "metals" today — see appendToInlineStringArray's own comment on why that
// one stays single-line instead of exploding to one-per-line). Values in
// this array are always simple kebab-case slugs (no embedded commas), so a
// plain comma-split is safe here unlike the general-purpose entry parsing
// splitTopLevelEntries does for nested object values.
function removeFromInlineStringArray(text, openAnchor, value) {
  const startIdx = text.indexOf(openAnchor);
  if (startIdx === -1) return null;
  const afterOpen = startIdx + openAnchor.length;
  const closeIdx = findMatchingClose(text, afterOpen, "[", "]");
  if (closeIdx === -1) return null;
  const inner = text.slice(afterOpen, closeIdx);
  const items = inner.split(",").map((s) => s.trim()).filter(Boolean);
  const targetQuoted = '"' + esc(value) + '"';
  const filtered = items.filter((it) => it !== targetQuoted);
  if (filtered.length === items.length) return null;
  return text.slice(0, afterOpen) + filtered.join(", ") + text.slice(closeIdx);
}

// Patches an existing key's value inside a flat object opened by
// `openAnchor` (categories{}/hdris{}) — the "edit" counterpart to
// insertBeforeObjectClose's "add". Value may be a plain string (hdris) or a
// one-level-nested object (categories' `{ "sizes": [...], "unit": "..." }`
// — safe to match non-nested-braces since "sizes" is an array, not itself
// an object).
function updateObjectEntryInText(text, openAnchor, key, newValueText) {
  const startIdx = text.indexOf(openAnchor);
  if (startIdx === -1) return null;
  const afterOpen = startIdx + openAnchor.length;
  const closeIdx = findMatchingClose(text, afterOpen, "{", "}");
  if (closeIdx === -1) return null;
  const block = text.slice(afterOpen, closeIdx);
  const keyPattern = new RegExp('("' + key + '":\\s*)(\\{[^}]*\\}|"[^"]*")');
  if (!keyPattern.test(block)) return null;
  const newBlock = block.replace(keyPattern, "$1" + newValueText);
  return text.slice(0, afterOpen) + newBlock + text.slice(closeIdx);
}

// Patches one field on an existing series, scoped by its unique "slug" the
// same way scripts/scene-tool-server.js's updateSeriesHdriInText already
// does — generalized here to any of name/year/hdri (quoted-string fields)
// or categories (a flat, non-nested string array). Deliberately field-by-
// field rather than a full-block regenerate (see renderSeriesBlock) so an
// edit can never touch a series' own "hero": {...} sub-object, which is
// pure hand-authored content this tool must never rewrite.
function updateSeriesFieldInText(text, seriesSlug, fieldName, newValueText) {
  const slugAnchor = '"slug": "' + seriesSlug + '"';
  const startIdx = text.indexOf(slugAnchor);
  if (startIdx === -1) return null;
  const nextSlugIdx = text.indexOf('"slug": "', startIdx + slugAnchor.length);
  const blockEnd = nextSlugIdx === -1 ? text.length : nextSlugIdx;
  const block = text.slice(startIdx, blockEnd);
  const fieldPattern = new RegExp('"' + fieldName + '":\\s*(\\[[^\\]]*\\]|"[^"]*")');
  if (!fieldPattern.test(block)) return null;
  const newBlock = block.replace(fieldPattern, '"' + fieldName + '": ' + newValueText);
  return text.slice(0, startIdx) + newBlock + text.slice(blockEnd);
}

// Finds a `{ ... }` block by a unique `"anchorKey": "anchorValue"` field
// inside it (e.g. a product's "id", a series' "slug"). Unlike scripts/
// auto-render.js's/scene-tool-server.js's own anchored patchers (which only
// need a span wide enough to regex a small field within), this walks back
// to the block's real opening "{" (always the character immediately
// preceding the anchor field — it's always the first field in both a
// product and a series entry) and forward to that brace's real matching
// "}", so the whole block can be swapped out or removed atomically.
function findBlockSpanByAnchor(text, anchorKey, anchorValue) {
  const anchor = '"' + anchorKey + '": "' + anchorValue + '"';
  const anchorIdx = text.indexOf(anchor);
  if (anchorIdx === -1) return null;
  const openIdx = text.lastIndexOf("{", anchorIdx);
  if (openIdx === -1) return null;
  const closeIdx = findMatchingClose(text, openIdx + 1, "{", "}");
  if (closeIdx === -1) return null;
  return { start: openIdx, end: closeIdx + 1 };
}

function findProductBlockSpan(text, productId) {
  return findBlockSpanByAnchor(text, "id", productId);
}

// Replaces one product's whole block in place (used by product edit — see
// renderProductBlock for why edit/add share one renderer). `newBlockText`
// is trim()'d because its own leading "    {"/trailing "    }" indentation
// is redundant with what's already sitting in the surrounding file text at
// the splice point.
function replaceProductBlockInText(text, productId, newBlockText) {
  const span = findProductBlockSpan(text, productId);
  if (!span) return null;
  return text.slice(0, span.start) + newBlockText.trim() + text.slice(span.end);
}

// Deletes the array-element text at `span` (as found by
// findBlockSpanByAnchor) along with exactly one adjacent comma — the
// trailing one if this wasn't the last element, else the leading one —
// so the surrounding array stays valid JSON. Doesn't otherwise try to
// tidy up incidental leftover blank lines around the cut; harmless
// whitespace, consistent with this file's "canonical, not byte-perfect"
// philosophy (see the file header comment).
function removeArrayEntryInText(text, span) {
  let start = span.start;
  let end = span.end;
  let i = end;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === ",") {
    end = i + 1;
  } else {
    let j = start - 1;
    while (j >= 0 && /\s/.test(text[j])) j--;
    if (text[j] === ",") start = j;
  }
  return text.slice(0, start) + text.slice(end);
}

// Removes one product's whole block (and its file's array structure stays
// valid) — used by product removal. Does NOT touch anything on disk; the
// caller is responsible for deleting that product's asset folder.
function removeProductBlockInText(text, productId) {
  const span = findProductBlockSpan(text, productId);
  if (!span) return null;
  return removeArrayEntryInText(text, span);
}

// Removes one series' whole block from data/series.json's top-level
// "series" array — used by series removal. Does NOT touch anything on
// disk; the caller is responsible for deleting that series' data/hero/
// asset folders.
function removeSeriesBlockInText(text, seriesSlug) {
  const span = findBlockSpanByAnchor(text, "slug", seriesSlug);
  if (!span) return null;
  return removeArrayEntryInText(text, span);
}

function renderMetalPathMap(map, metals, indent) {
  map = map || {};
  return metals.map((m) => indent + '"' + m + '": "' + esc(map[m]) + '"').join(",\n");
}

// Full-block renderer for one product, shared by product add AND edit.
// Field order/shape matches the real hand-authored file exactly — see
// data/series/bones/products.json's Furcula entry.
function renderProductBlock(p, metals) {
  const specs = p["per-metal-specs"] || {};
  const perMetal = metals
    .map((m) => {
      const s = specs[m] || { price: 0, weight: "", composition: "" };
      return '        "' + m + '": { "price": ' + num(s.price) + ', "weight": "' + esc(s.weight) + '", "composition": "' + esc(s.composition) + '" }';
    })
    .join(",\n");

  const assets = p.assets || {};
  const hhv = p["hero-hand-visibility"] || { visible: false, x: 50, y: 50, scale: 6, rotation: 0 };
  const cam = p["3d-viewer-camera-default"] || { rotation: 0, tilt: 75, zoom: 105 };
  const photos = (assets.photos || []).map((x) => '"' + esc(x) + '"').join(", ");

  return [
    "    {",
    '      "id": "' + esc(p.id) + '",',
    '      "name": "' + esc(p.name) + '",',
    '      "category": "' + esc(p.category) + '",',
    '      "description": "' + esc(p.description) + '",',
    '      "default-metal": "' + esc(p["default-metal"]) + '",',
    '      "per-metal-specs": {',
    perMetal,
    "      },",
    '      "hero-hand-visibility": { "visible": ' + bool(hhv.visible) + ', "x": ' + num(hhv.x) + ', "y": ' + num(hhv.y) + ', "scale": ' + num(hhv.scale) + ', "rotation": ' + num(hhv.rotation) + " },",
    '      "3d-viewer-camera-default": { "rotation": ' + num(cam.rotation) + ', "tilt": ' + num(cam.tilt) + ', "zoom": ' + num(cam.zoom) + " },",
    '      "assets": {',
    '        "model": "' + esc(assets.model) + '",',
    '        "icons": {',
    renderMetalPathMap(assets.icons, metals, "          "),
    "        },",
    '        "fallback-img": {',
    renderMetalPathMap(assets["fallback-img"], metals, "          "),
    "        },",
    '        "xray": "' + esc(assets.xray) + '",',
    '        "top-shot": {',
    renderMetalPathMap(assets["top-shot"], metals, "          "),
    "        },",
    '        "photos": [' + photos + "]",
    "      }",
    "    }"
  ].join("\n");
}

// Full-block renderer for a brand-new series (edits to an existing series
// use updateSeriesFieldInText instead — see its own comment for why).
// Shape matches data/series.json's real "bones" entry exactly.
function renderSeriesBlock(s) {
  const categories = (s.categories || []).map((c) => '"' + esc(c) + '"').join(", ");
  const hero = s.hero || {};
  const preload = (hero.preload || []).map((x) => '"' + esc(x) + '"').join(", ");
  return [
    "    {",
    '      "slug": "' + esc(s.slug) + '",',
    '      "name": "' + esc(s.name) + '",',
    '      "year": "' + esc(s.year) + '",',
    '      "categories": [' + categories + "],",
    '      "products": "' + esc(s.products) + '",',
    '      "hdri": "' + esc(s.hdri) + '",',
    '      "manifest": "' + esc(s.manifest) + '",',
    '      "hero": {',
    '        "fragment": "' + esc(hero.fragment) + '",',
    '        "css":      "' + esc(hero.css) + '",',
    '        "js":       "' + esc(hero.js) + '",',
    '        "preload": [' + preload + "]",
    "      }",
    "    }"
  ].join("\n");
}

module.exports = {
  esc,
  num,
  slug,
  insertBeforeArrayClose,
  insertBeforeObjectClose,
  appendToInlineStringArray,
  updateTopLevelScalarInText,
  updateObjectEntryInText,
  removeObjectEntryInText,
  removeFromInlineStringArray,
  updateSeriesFieldInText,
  findBlockSpanByAnchor,
  findProductBlockSpan,
  replaceProductBlockInText,
  removeArrayEntryInText,
  removeProductBlockInText,
  removeSeriesBlockInText,
  renderProductBlock,
  renderSeriesBlock
};
