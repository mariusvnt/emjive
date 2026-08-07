/* ==========================================================================
   Lab-lens artefact
   Toggles visibility of the fixed .lens-artefact overlay (css/style.css) in
   step with the hero's own scroll-driven reveal. Mirrors js/selection-bar.js's
   existing window.EmjiveHero.onScroll subscription rather than adding a new
   event: EmjiveHero already publishes one number every scroll frame (how far
   past the hero's trigger point the page has scrolled) plus a hasScrollRange
   bool, and "past the trigger" is the same moment selection-bar.js treats as
   the start of its own entrance — by then the frontier band has already
   cleared the header and the reveal reads as visually finished.

   Self-guards on #lensArtefact existing, so this is inert on any page that
   doesn't include the element (today, only index.html does).
   ========================================================================== */

(function () {
  "use strict";

  var el = document.getElementById("lensArtefact");
  if (!el || !window.EmjiveHero) return;

  window.EmjiveHero.onScroll(function (pastTriggerPx, hasScrollRange) {
    // Bidirectional on purpose: pastTriggerPx drops back to 0 on scroll-up,
    // so the lens fades back out rather than staying revealed for good.
    var revealed = !hasScrollRange || pastTriggerPx > 0;
    el.classList.toggle("is-visible", revealed);
  });
})();
