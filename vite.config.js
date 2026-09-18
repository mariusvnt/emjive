import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Vite's static asset pipeline only ever sees paths it can trace at build
// time: <script>/<link>/<img> attributes in the HTML entries themselves,
// and url()/import references inside processed CSS/JS. This site's real
// asset paths mostly come from a series' products.json (icons/top-shot/model
// paths, fetched and read as plain string data at runtime) or from a bare
// string constant in js/three-viewer.js (HDRI_SRC) — none of that is
// something Vite's build can see, so those folders would silently be left
// out of dist/ entirely without this. js/ needs the same treatment for a
// different reason: Vite can only bundle <script type="module"> tags
// (three-viewer.js) — a plain classic <script src="js/main.js"> can't be
// bundled, and Vite doesn't copy what it can't bundle either, so without
// this every classic script (main.js, product.js, selection*.js) would
// silently vanish from the build even though the built HTML still
// references them (confirmed by inspecting dist/ directly — worth
// re-checking after any future Vite upgrade in case this behavior
// changes). Copying all three verbatim (byte-for-byte, original
// filenames) after the real build sidesteps having to trace every
// dynamic/classic-script reference individually — a bit of redundant
// output for whatever Vite's own pipeline *did* catch (e.g. CSS url()s,
// the header's static <img> tags, three-viewer.js's own module bundle),
// but that's harmless.
//
// series/ is on the list for the same reason as data/: it holds each
// series' hero bundle (hero.html/hero.css/hero.js), which is referenced
// only as string paths inside data/series.json and injected at runtime, so
// Vite's build has no way to see it. That's also why a hero bundle's JS can
// never use a bare specifier — nothing resolves it.
// Copying whole trees is the right default (see above) but it is not free:
// each of these was verified to ship in dist/ and never be requested by any
// built page. Together they were ~2MB of the output.
//
//   assets/fonts/  — Vite DOES trace the @font-face url()s in css/style.css
//     and the <link rel="preload"> hrefs in every page's <head>, so it emits
//     its own content-hashed copies (dist/assets/DINish-Regular-<hash>.woff2
//     et al) and rewrites both references to point at them. Nothing in the
//     built output mentions assets/fonts/ at all — and only 5 of the 45
//     files in there were ever referenced to begin with. Re-check this if a
//     font is ever loaded from a runtime string rather than from CSS.
//   assets/hand_normal.webp — genuinely dead, in the repo and in the build
//     (see assets.md); it's the plain hand the ring-embossed hero replaced.
//   js/three-viewer.js — the unbundled ES module source. The built pages
//     load Vite's bundled copy (dist/assets/three-viewer-<hash>.js); this
//     one still carries the bare `import "three"` specifier that nothing at
//     runtime can resolve, so shipping it is at best dead weight and at
//     worst a trap for anyone who finds it in dist/ and assumes it runs.
//     Every OTHER file in js/ is a classic script the built HTML really
//     does load by its original path, which is why this is one exclusion
//     rather than a rule about js/.
const NEVER_COPY = [
  resolve(__dirname, "assets", "fonts"),
  resolve(__dirname, "assets", "hand_normal.webp"),
  resolve(__dirname, "js", "three-viewer.js")
];

function copyFilesVitesBuildCantTrace() {
  return {
    name: "copy-files-vites-build-cant-trace",
    closeBundle() {
      for (const dir of ["assets", "data", "js", "series"]) {
        const src = resolve(__dirname, dir);
        if (existsSync(src)) {
          cpSync(src, resolve(__dirname, "dist", dir), {
            recursive: true,
            filter: (from) => !NEVER_COPY.includes(from)
          });
        }
      }
    }
  };
}

// three's own DRACOLoader.js resolves its bundled decoder with
// `new URL('../libs/draco/draco_decoder.wasm', import.meta.url)` (and four
// siblings). Vite treats that pattern as a static asset reference, so it
// emits all five into dist/assets/ — ~1.26MB of .wasm and .js — even though
// this site can never request them: js/three-viewer.js calls
// setDecoderPath(new URL("assets/draco/", document.baseURI).href) before any
// load, which replaces every one of those URLs with our own self-hosted copy
// under assets/draco/ (kept, and still copied by the plugin above).
//
// Deleting them from the bundle rather than from disk afterwards, so the
// manifest stays truthful and nothing else can end up referencing a file
// that isn't there. If the decoder path in js/three-viewer.js is ever
// removed or made conditional, this has to go with it — three would then
// genuinely need the copies it emitted.
function dropUnusedDracoDecoderCopies() {
  return {
    name: "drop-unused-draco-decoder-copies",
    generateBundle(options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/draco_(decoder|wasm_wrapper)/.test(fileName)) delete bundle[fileName];
      }
    }
  };
}

export default defineConfig({
  // GitHub Pages project sites (mariusvnt.github.io/emjive/) are served
  // from a subpath, not the domain root — every built <script>/<link>
  // reference needs that prefix to resolve correctly. Flip this back to
  // "/" (the default) once the site moves to its own domain.
  base: "/emjive/",
  plugins: [dropUnusedDracoDecoderCopies(), copyFilesVitesBuildCantTrace()],
  build: {
    rollupOptions: {
      // Vite only treats index.html as an entry by default — every other
      // page needs listing explicitly or its own <script type="module">
      // tags (three-viewer.js on product.html) would ship unprocessed,
      // with the same unresolved bare-specifier "three" import that broke
      // index.html on GitHub Pages. Add a line here for any new page.
      input: {
        main: resolve(__dirname, "index.html"),
        product: resolve(__dirname, "product.html"),
        launchOrder: resolve(__dirname, "launch-order.html"),
        archives: resolve(__dirname, "archives.html"),
        creationProcess: resolve(__dirname, "creation-process.html"),
        series: resolve(__dirname, "series.html"),
        terms: resolve(__dirname, "terms.html")
      }
    }
  }
});
