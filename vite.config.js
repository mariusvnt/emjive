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
function copyFilesVitesBuildCantTrace() {
  return {
    name: "copy-files-vites-build-cant-trace",
    closeBundle() {
      for (const dir of ["assets", "data", "js", "series"]) {
        const src = resolve(__dirname, dir);
        if (existsSync(src)) {
          cpSync(src, resolve(__dirname, "dist", dir), { recursive: true });
        }
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
  plugins: [copyFilesVitesBuildCantTrace()],
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
        series: resolve(__dirname, "series.html")
      }
    }
  }
});
