/* ==========================================================================
   series.html — renders one series' design manifest.

   The page itself is still an empty shell by design; this only wires up the
   route (title, year, subtitle, and a real not-found state) so the URL is
   verifiable now, while the body stays blank until the manifest is designed.
   Rendering manifest.json's "sections" array belongs here later — see
   dev-guidelines/data.md for the schema.
   ========================================================================== */

(function () {
  "use strict";

  var loadingEl = document.getElementById("seriesManifestLoading");
  var contentEl = document.getElementById("seriesManifestContent");
  if (!loadingEl || !contentEl) return;

  function showNotFound(slug) {
    loadingEl.textContent = slug
      ? "No series called “" + slug + "” — "
      : "No series specified — ";
    var link = document.createElement("a");
    link.className = "btn";
    link.href = "archives.html";
    link.textContent = "Browse the archives";
    loadingEl.appendChild(link);
  }

  window.EmjiveSeries.ready
    .then(function () {
      // Deliberately NOT EmjiveSeries.slug: that falls back to the featured
      // series, and silently showing the wrong series' manifest is worse
      // than saying it doesn't exist.
      var slug = window.EmjiveSeries.requestedSlug();
      var entry = slug && window.EmjiveSeries.get(slug);
      if (!entry) return showNotFound(slug);

      return window.EmjiveSeries.loadManifest(slug).then(function (manifest) {
        var title = manifest.title || entry.name || slug;
        document.title = title + " — em·ji·ve";

        document.getElementById("seriesManifestYear").textContent =
          manifest.year || entry.year || "";
        document.getElementById("seriesManifestTitle").textContent = title;

        var subtitleEl = document.getElementById("seriesManifestSubtitle");
        subtitleEl.textContent = manifest.subtitle || "";
        subtitleEl.hidden = !manifest.subtitle;

        loadingEl.hidden = true;
        contentEl.hidden = false;
      });
    })
    .catch(function () {
      showNotFound(window.EmjiveSeries.requestedSlug());
    });
})();
