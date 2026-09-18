#!/usr/bin/env node
/* ==========================================================================
   optimize-hdri — halves the Radiance .hdr environment maps the 3D viewer
   lights every model with.

   Why this exists. The HDRI is the single heaviest thing the site downloads
   and nothing about the page hints at it: at 2048x1024,
   studio_kontrast_04_2k.hdr was 5.62 MB — 61% of the homepage's total
   weight, and more than five times the combined size of the three ring
   models it was lighting. It's also on the critical path in the worst way.
   js/three-viewer.js does Promise.all([modelPromise, environmentPromise])
   before its first render, so NO model appears until the whole HDRI has
   landed, however small that model is.

   Why halving costs nothing visible. The texture is never displayed. It's
   fed straight to THREE.PMREMGenerator, which prefilters it into a small
   mip chain of roughness-blurred cube faces — the top level is 256px a side
   — and only that chain is ever sampled. Going 2048 -> 1024 removes detail
   that PMREM's own first downsample was going to throw away regardless. The
   one case where it would show is a mirror-perfect surface reflecting a
   sharp light source; the roughest metal here is silver at roughness 0.09,
   which is close enough to that to be worth an eyeball before committing —
   hence --dry-run, which reports without writing.

   Why this is hand-rolled rather than a call into sharp. sharp is already a
   devDependency and is the obvious tool, and it cannot do this: the libvips
   build it ships has Radiance support compiled out
   (sharp.format.rad.input.file === false on libvips 8.18.3). ImageMagick and
   ffmpeg can both read and write .hdr, but making either a prerequisite
   would be the only non-npm system dependency in the repo, for one file
   format used by three files. RGBE is a small, completely specified format,
   so it's cheaper to just implement it.

   THE ONE THING TO NOT GET WRONG, if this is ever modified: the downsample
   happens in LINEAR space, never on the RGBE bytes. RGBE packs a pixel as
   three 8-bit mantissas plus ONE shared 8-bit exponent, so two neighbouring
   pixels only have comparable mantissas when their exponents match.
   Box-filtering the bytes directly — averaging an (R,G,B,E) quad with a
   different (R,G,B,E) quad — is averaging numbers on two different scales,
   and in a high-dynamic-range image that is not a subtle error: a bright
   window next to a dark wall differs by several exponent steps, and the
   naive average lands orders of magnitude off. decodeToLinear() below
   expands every pixel to real floats first; the box filter runs there; only
   then is the result re-encoded.

   Usage:
     npm run optimize-hdri -- --dry-run     report only, write nothing
     npm run optimize-hdri                  halve every .hdr wider than 1024
     npm run optimize-hdri -- <path.hdr>    only this one
     npm run optimize-hdri -- --width=512   target width other than 1024

   Unlike optimize-models/optimize-images, this does NOT rewrite in place:
   the width is part of the filename by convention (studio_..._2k.hdr), so a
   halved file under the old name would be a lie. It writes a sibling with
   the new bucket in its name and tells you which data/series.json path to
   update. Git is the undo either way.
   ========================================================================== */

const { readdirSync, statSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve, relative, dirname, basename } = require("node:path");

const REPO_ROOT = resolve(__dirname, "..");
const HDRI_DIR = join(REPO_ROOT, "assets", "hdri");

// Anything at or below this is left alone. 1024x512 is what two of the
// three current files already are, and it's the point where PMREM's own
// prefiltering stops being able to tell the difference on this site's
// materials.
const DEFAULT_TARGET_WIDTH = 1024;

/* ---- Radiance RGBE decoding --------------------------------------------
   Format reference: Greg Ward's original, as shipped in Radiance's
   color.c/header.c. The parts that matter here:

     #?RADIANCE          magic
     FORMAT=...          one of several variables, terminated by a blank line
     -Y <h> +X <w>       resolution line, immediately before the pixel data

   Only the -Y/+X orientation is handled. It is the one every tool in the
   wild writes, and silently mis-decoding one of the seven other orientations
   would be far worse than refusing it.
   ----------------------------------------------------------------------- */

function parseHeader(buf) {
  const magic = buf.toString("ascii", 0, 10);
  if (!magic.startsWith("#?RADIANCE") && !magic.startsWith("#?RGBE")) {
    throw new Error("not a Radiance file (bad magic)");
  }

  let offset = 0;
  let format = null;
  let sawBlankLine = false;

  // Header lines are \n-terminated ASCII. Read them one at a time rather
  // than splitting the whole buffer: everything after the resolution line
  // is binary and must not be touched as text.
  for (;;) {
    const nl = buf.indexOf(0x0a, offset);
    if (nl === -1) throw new Error("malformed header (no resolution line)");
    const line = buf.toString("ascii", offset, nl).trim();
    offset = nl + 1;

    if (line.startsWith("FORMAT=")) format = line.slice(7).trim();

    if (line === "") {
      sawBlankLine = true;
      continue;
    }
    // The resolution line is what actually ends the header, and it only
    // counts once the blank line separating variables from it has been seen.
    if (sawBlankLine) {
      const res = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(line);
      if (!res) {
        throw new Error(
          'unsupported resolution line "' + line + '" — only "-Y <h> +X <w>" is handled'
        );
      }
      return {
        width: parseInt(res[2], 10),
        height: parseInt(res[1], 10),
        format: format,
        dataOffset: offset
      };
    }
  }
}

// One scanline of RGBE bytes -> `out` (RGBE-interleaved, 4 bytes per pixel).
// Returns the new read offset.
//
// Two encodings coexist in the wild and a real file can mix them line by
// line, so both are handled per scanline rather than per file:
//
//   * Adaptive RLE ("new" RLE): marked by the 0x02 0x02 header below. Each
//     of the four CHANNELS is run-length encoded separately across the whole
//     scanline, which is why the output has to be strided by 4 rather than
//     written contiguously.
//   * Flat: 4 bytes per pixel, no compression. Also the fallback for any
//     scanline too short or too wide to be adaptive.
function readScanline(buf, offset, width, out) {
  const adaptive =
    width >= 8 &&
    width < 32768 &&
    buf[offset] === 2 &&
    buf[offset + 1] === 2 &&
    ((buf[offset + 2] << 8) | buf[offset + 3]) === width;

  if (!adaptive) {
    for (let x = 0; x < width; x++) {
      out[x * 4] = buf[offset++];
      out[x * 4 + 1] = buf[offset++];
      out[x * 4 + 2] = buf[offset++];
      out[x * 4 + 3] = buf[offset++];
    }
    return offset;
  }

  offset += 4; // consume the 0x02 0x02 <width-hi> <width-lo> marker
  for (let channel = 0; channel < 4; channel++) {
    let x = 0;
    while (x < width) {
      let count = buf[offset++];
      if (count > 128) {
        // A run: one value repeated (count - 128) times.
        count -= 128;
        const value = buf[offset++];
        if (x + count > width) throw new Error("RLE run overruns the scanline");
        for (let i = 0; i < count; i++) out[(x++) * 4 + channel] = value;
      } else {
        // A literal span of `count` distinct values.
        if (count === 0) throw new Error("zero-length RLE span");
        if (x + count > width) throw new Error("RLE span overruns the scanline");
        for (let i = 0; i < count; i++) out[(x++) * 4 + channel] = buf[offset++];
      }
    }
  }
  return offset;
}

// -> { width, height, data: Float32Array } — three linear floats per pixel.
//
// The exponent bias is 128 and the mantissa is offset by another 8 bits
// (i.e. the stored byte represents a value in [0,255] scaled by 1/256), so
// the standard reconstruction is value = mantissa * 2^(e - 128 - 8). e === 0
// is the encoding of exact black and must short-circuit: 2^-136 is not zero
// but it is also not what the file means.
function decodeToLinear(buf) {
  const header = parseHeader(buf);
  const { width, height, dataOffset } = header;
  const rgbe = new Uint8Array(width * 4);
  const out = new Float32Array(width * height * 3);

  let offset = dataOffset;
  for (let y = 0; y < height; y++) {
    offset = readScanline(buf, offset, width, rgbe);
    const row = y * width * 3;
    for (let x = 0; x < width; x++) {
      const e = rgbe[x * 4 + 3];
      if (e === 0) {
        out[row + x * 3] = 0;
        out[row + x * 3 + 1] = 0;
        out[row + x * 3 + 2] = 0;
        continue;
      }
      const scale = Math.pow(2, e - 136);
      out[row + x * 3] = rgbe[x * 4] * scale;
      out[row + x * 3 + 1] = rgbe[x * 4 + 1] * scale;
      out[row + x * 3 + 2] = rgbe[x * 4 + 2] * scale;
    }
  }
  return { width, height, format: header.format, data: out };
}

/* ---- resampling ---------------------------------------------------------
   A plain box filter over an integer block, which is the right choice here
   precisely because it is the dumb one: the reductions this script does are
   exact integer ratios (2048 -> 1024 is 2x2), and for an exact ratio a box
   filter IS the correct area average — no ringing, no negative lobes, and
   critically no possibility of a lanczos-style undershoot producing a
   NEGATIVE radiance value that RGBE cannot represent.

   Guarded to exact integer ratios for that reason. A non-integer target
   would need a real resampling kernel and the clamping that goes with it.
   ----------------------------------------------------------------------- */
function boxDownsample(src, srcWidth, srcHeight, dstWidth, dstHeight) {
  const bx = srcWidth / dstWidth;
  const by = srcHeight / dstHeight;
  if (!Number.isInteger(bx) || !Number.isInteger(by)) {
    throw new Error(
      "only integer reduction ratios are supported (got " +
        srcWidth + "x" + srcHeight + " -> " + dstWidth + "x" + dstHeight + ")"
    );
  }

  const out = new Float32Array(dstWidth * dstHeight * 3);
  const samples = bx * by;
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < by; sy++) {
        const srcRow = (y * by + sy) * srcWidth * 3;
        for (let sx = 0; sx < bx; sx++) {
          const i = srcRow + (x * bx + sx) * 3;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
        }
      }
      const o = (y * dstWidth + x) * 3;
      out[o] = r / samples;
      out[o + 1] = g / samples;
      out[o + 2] = b / samples;
    }
  }
  return out;
}

/* ---- Radiance RGBE encoding -------------------------------------------- */

// One linear RGB triple -> 4 RGBE bytes written into `out` at `at`.
// frexp-by-hand: Math.log2 + Math.floor would misbehave on exact powers of
// two, so the exponent comes from the standard "scale until the largest
// channel is in [0.5, 1)" formulation instead.
function encodePixel(r, g, b, out, at) {
  const max = Math.max(r, g, b);
  if (max < 1e-32) {
    out[at] = 0;
    out[at + 1] = 0;
    out[at + 2] = 0;
    out[at + 3] = 0;
    return;
  }
  let e = Math.ceil(Math.log2(max));
  // Math.log2 is not exact for every input; nudge until the invariant
  // (max * 2^-e) < 1 actually holds, so the mantissa can never round to 256
  // and overflow its byte.
  while (max * Math.pow(2, -e) >= 1) e++;
  while (max * Math.pow(2, -e) < 0.5) e--;
  const scale = Math.pow(2, -e) * 256;
  out[at] = Math.min(255, Math.floor(r * scale));
  out[at + 1] = Math.min(255, Math.floor(g * scale));
  out[at + 2] = Math.min(255, Math.floor(b * scale));
  out[at + 3] = e + 128;
}

// Adaptive RLE, per channel, matching what readScanline expects. Runs of 4+
// identical bytes are worth encoding as a run; shorter ones cost more in
// span headers than they save, which is the same threshold Radiance's own
// writer uses.
function encodeScanline(rgbe, width, chunks) {
  const header = Buffer.alloc(4);
  header[0] = 2;
  header[1] = 2;
  header[2] = (width >> 8) & 0xff;
  header[3] = width & 0xff;
  chunks.push(header);

  for (let channel = 0; channel < 4; channel++) {
    const line = Buffer.alloc(width);
    for (let x = 0; x < width; x++) line[x] = rgbe[x * 4 + channel];

    const encoded = [];
    let x = 0;
    while (x < width) {
      // How far does the run starting here reach?
      let runEnd = x;
      while (runEnd < width && line[runEnd] === line[x]) runEnd++;
      const runLength = runEnd - x;

      if (runLength >= 4) {
        let remaining = runLength;
        while (remaining > 0) {
          const n = Math.min(127, remaining); // 128 + n must stay in a byte
          encoded.push(128 + n, line[x]);
          remaining -= n;
        }
        x = runEnd;
        continue;
      }

      // A literal span, running until a run of 4+ starts.
      let spanEnd = x;
      while (spanEnd < width) {
        let ahead = spanEnd;
        while (ahead < width && line[ahead] === line[spanEnd]) ahead++;
        if (ahead - spanEnd >= 4) break;
        spanEnd = ahead;
      }
      let spanStart = x;
      while (spanStart < spanEnd) {
        const n = Math.min(128, spanEnd - spanStart);
        encoded.push(n);
        for (let i = 0; i < n; i++) encoded.push(line[spanStart + i]);
        spanStart += n;
      }
      x = spanEnd;
    }
    chunks.push(Buffer.from(encoded));
  }
}

function encodeHdr(linear, width, height, formatLine) {
  const chunks = [];
  chunks.push(
    Buffer.from(
      "#?RADIANCE\n" +
        "# Downsampled by scripts/optimize-hdri.js\n" +
        "FORMAT=" + (formatLine || "32-bit_rle_rgbe") + "\n" +
        "\n" +
        "-Y " + height + " +X " + width + "\n",
      "ascii"
    )
  );

  const rgbe = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    const row = y * width * 3;
    for (let x = 0; x < width; x++) {
      encodePixel(linear[row + x * 3], linear[row + x * 3 + 1], linear[row + x * 3 + 2], rgbe, x * 4);
    }
    encodeScanline(rgbe, width, chunks);
  }
  return Buffer.concat(chunks);
}

/* ---- naming -------------------------------------------------------------
   assets/hdri/ encodes width as a `_<n>k` bucket in the filename
   (studio_kontrast_04_2k.hdr). Rewrite that bucket rather than appending a
   second one, and fall back to appending only if the name has no bucket to
   rewrite.

   Note two of the three current files are ALREADY misnamed in the other
   direction — white-room_2k.hdr is 1024x512 — which is exactly why this
   derives the bucket from the real pixel width instead of trusting the name.
   ----------------------------------------------------------------------- */
function bucketFor(width) {
  return Math.max(1, Math.round(width / 1024)) + "k";
}

function targetNameFor(file, width) {
  const base = basename(file, ".hdr");
  const bucket = bucketFor(width);
  const rewritten = base.replace(/_\d+k$/, "_" + bucket);
  return (rewritten === base ? base + "_" + bucket : rewritten) + ".hdr";
}

/* ---- run ---------------------------------------------------------------- */

function listHdris() {
  if (!existsSync(HDRI_DIR)) return [];
  return readdirSync(HDRI_DIR)
    .filter((name) => name.toLowerCase().endsWith(".hdr"))
    .map((name) => join(HDRI_DIR, name));
}

function formatBytes(n) {
  return (n / 1048576).toFixed(2) + " MB";
}

// Mean luminance, Rec.709 weights. Compared before and after as the
// round-trip check: a box average preserves it to within floating-point
// noise, so a delta beyond a fraction of a percent means the decode, the
// resample or the encode is wrong — which is exactly the class of bug that
// would otherwise ship as "the models look a bit off" months later.
function meanLuminance(linear) {
  let sum = 0;
  const pixels = linear.length / 3;
  for (let i = 0; i < linear.length; i += 3) {
    sum += 0.2126 * linear[i] + 0.7152 * linear[i + 1] + 0.0722 * linear[i + 2];
  }
  return sum / pixels;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const widthArg = args.find((a) => a.startsWith("--width="));
  const targetWidth = widthArg ? parseInt(widthArg.slice(8), 10) : DEFAULT_TARGET_WIDTH;
  if (!Number.isInteger(targetWidth) || targetWidth < 1) {
    console.error("--width must be a positive integer");
    process.exitCode = 1;
    return;
  }

  const explicit = args.filter((a) => !a.startsWith("--")).map((p) => resolve(REPO_ROOT, p));
  const files = explicit.length ? explicit : listHdris();

  if (!files.length) {
    console.log("No .hdr files found under assets/hdri/.");
    return;
  }

  console.log(
    (dryRun ? "Dry run — " : "") +
      "target width " + targetWidth + ", " + files.length + " file(s) to consider\n"
  );

  let failures = 0;
  let written = 0;
  let savedBytes = 0;
  const pathUpdates = [];

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    if (!existsSync(file)) {
      console.error("  " + rel + " — not found");
      failures++;
      continue;
    }

    let source;
    try {
      source = decodeToLinear(readFileSync(file));
    } catch (err) {
      console.error("  " + rel + " — could not decode: " + err.message);
      failures++;
      continue;
    }

    const sizeBefore = statSync(file).size;
    if (source.width <= targetWidth) {
      console.log(
        "  " + rel + " — already " + source.width + "x" + source.height +
          " (" + formatBytes(sizeBefore) + "), skipped"
      );
      continue;
    }

    const dstWidth = targetWidth;
    const dstHeight = Math.round((source.height / source.width) * targetWidth);

    let resampled;
    try {
      resampled = boxDownsample(source.data, source.width, source.height, dstWidth, dstHeight);
    } catch (err) {
      console.error("  " + rel + " — " + err.message);
      failures++;
      continue;
    }

    const encoded = encodeHdr(resampled, dstWidth, dstHeight, source.format);

    // Round trip: re-decode what was just encoded, from the exact bytes that
    // would be written, and check both the geometry and the light level.
    let check;
    try {
      check = decodeToLinear(encoded);
    } catch (err) {
      console.error("  " + rel + " — output failed to re-decode: " + err.message);
      failures++;
      continue;
    }
    if (check.width !== dstWidth || check.height !== dstHeight) {
      console.error(
        "  " + rel + " — round trip changed dimensions: expected " +
          dstWidth + "x" + dstHeight + ", got " + check.width + "x" + check.height
      );
      failures++;
      continue;
    }
    const before = meanLuminance(resampled);
    const after = meanLuminance(check.data);
    const drift = before === 0 ? 0 : Math.abs(after - before) / before;
    if (drift > 0.01) {
      console.error(
        "  " + rel + " — round trip shifted mean luminance by " +
          (drift * 100).toFixed(2) + "% (limit 1%)"
      );
      failures++;
      continue;
    }

    const outName = targetNameFor(file, dstWidth);
    const outPath = join(dirname(file), outName);
    const outRel = relative(REPO_ROOT, outPath).replace(/\\/g, "/");

    console.log(
      "  " + rel + "\n" +
        "      " + source.width + "x" + source.height + "  " + formatBytes(sizeBefore) +
        "   ->   " + dstWidth + "x" + dstHeight + "  " + formatBytes(encoded.length) +
        "   (-" + (100 - (encoded.length / sizeBefore) * 100).toFixed(1) + "%)\n" +
        "      luminance drift " + (drift * 100).toFixed(4) + "%   ->  " + outRel
    );

    savedBytes += sizeBefore - encoded.length;

    if (!dryRun) {
      if (outPath === file) {
        console.error("      refusing to overwrite the source under the same name");
        failures++;
        continue;
      }
      writeFileSync(outPath, encoded);
      written++;
      pathUpdates.push({ from: rel, to: outRel });
    }
  }

  console.log("");
  if (dryRun) {
    console.log("Dry run — nothing written. Would save " + formatBytes(savedBytes) + ".");
  } else if (written) {
    console.log("Wrote " + written + " file(s), saving " + formatBytes(savedBytes) + ".");
    console.log(
      "\nThe old files are still on disk and still referenced. Update the\n" +
        '"hdris" map in data/series.json, then delete the originals:\n'
    );
    pathUpdates.forEach((u) => console.log("  " + u.from + "\n    -> " + u.to));
  }

  if (failures) {
    console.error("\n" + failures + " file(s) failed.");
    process.exitCode = 1;
  }
}

main();
