/* ==========================================================================
   Bones — hero behaviour: frontier band lift, then scroll-driven x-ray wipe.

   Loaded at runtime by js/series.js from this series' "hero.js" path in
   data/series.json. Two rules this file has to keep:

   1. NO SIDE EFFECTS at execution time. It only assigns
      window.EmjiveSeriesHero and waits to be called. That's what lets the
      loader fetch the fragment, the stylesheet and this script all in
      parallel — two round trips to first hero paint instead of three.
   2. NO BARE SPECIFIERS. This is loaded via a runtime string path, so
      Vite never sees it and can't resolve `import "three"`. A hero needing
      3D calls window.EmjiveModelViewer (set by the bundled module) instead.

   Element lookups happen inside init(), not at execution time — the hero
   DOM doesn't exist until the loader has cloned the fragment in.
   ========================================================================== */

(function () {
  "use strict";

  var revealSection = null;
  var revealXrayGroup = null;
  var revealNormal = null;
  var revealFrontier = null;
  var siteHeader = null;
  var revealTicking = false;

  function updateReveal() {
    revealTicking = false;
    var rect = revealSection.getBoundingClientRect();
    // Unclamped — needed below to keep driving the selection bar's
    // entrance once scrolling continues past totalScroll, after the
    // pin itself has already released.
    var rawScrolled = Math.max(0, -rect.top);
    // Clamped to >= 0: on mobile browsers, CSS vh and window.innerHeight
    // can briefly disagree (dynamic address bar resizing the viewport),
    // which could otherwise make this negative and fall through to the
    // "fully revealed" branch below even at scroll position 0.
    var totalScroll = Math.max(0, rect.height - window.innerHeight);
    var scrolled = totalScroll > 0 ? Math.min(totalScroll, rawScrolled) : 0;

    // Phase 1: the frontier band lifts up from below the viewport until
    // it's flush with the pin's bottom edge (the normal image's bottom) —
    // this takes exactly one band-height of scrolling. Phase 2 only then
    // starts the x-ray wipe, with the band riding the reveal boundary.
    var liftDistance = Math.min(revealFrontier.getBoundingClientRect().height, totalScroll);
    var wipeDistance = Math.max(totalScroll - liftDistance, 1);

    if (totalScroll <= 0 || scrolled <= liftDistance) {
      var liftFraction = liftDistance > 0 ? scrolled / liftDistance : 1;
      revealFrontier.style.bottom = "calc(" + (-(1 - liftFraction)) + " * var(--reveal-frontier-height))";
      revealXrayGroup.style.clipPath = "inset(100% 0 0 0)";
      revealNormal.style.clipPath = "inset(0 0 0 0)";
    } else {
      var wipeProgress = Math.min(1, (scrolled - liftDistance) / wipeDistance);
      var revealedPct = wipeProgress * 100;
      revealFrontier.style.bottom = revealedPct + "%";
      // Complementary clips so the two never occupy the same region at
      // once — the x-ray (and ring, both inside revealXrayGroup) reveal
      // from the bottom up, the normal image gets clipped away from the
      // bottom by that same amount, regardless of any transparency in
      // the x-ray image.
      revealXrayGroup.style.clipPath = "inset(" + (100 - revealedPct) + "% 0 0 0)";
      revealNormal.style.clipPath = "inset(0 0 " + revealedPct + "% 0)";
    }

    // The floating selection bar's entrance continues directly off the
    // point where the frontier band's leading edge would pass behind the
    // fixed header — not where the wipe hits 100%, which is where the band
    // reaches the literal top of the viewport, already invisible (covered
    // by the header, z-index 80 vs. the band's own 2) well before that
    // point on any page with one. Same technique as liftDistance/
    // wipeDistance/wipeProgress above (measure the real element, turn a
    // scroll distance into a 0-1 progress): the band's own bottom edge
    // sits at screen-Y = innerHeight * (1 - wipeProgress) while riding the
    // wipe (the "bottom: X%" set on it above, expressed against that same
    // window height), so solving for the wipeProgress at which that equals
    // the header's own height gives the exact scroll position this phase
    // should start from, however tall the header happens to be at the
    // current viewport width — falls back to the literal wipe-complete
    // point (headerHeight 0) if there's no header on this page at all.
    //
    // Only the resulting scroll distance is published, not the transform:
    // how far the bar itself has to travel is the bar's own business (it
    // measures its summary row), and js/selection-bar.js subscribes to
    // this via window.EmjiveHero. Everything above the publish call is
    // hero geometry, which is why the header measurement stays here.
    var headerHeight = siteHeader ? siteHeader.getBoundingClientRect().height : 0;
    var wipeProgressAtHeader = window.innerHeight > 0
      ? Math.max(0, 1 - headerHeight / window.innerHeight)
      : 1;
    var barTriggerScroll = liftDistance + wipeProgressAtHeader * wipeDistance;
    window.EmjiveHero.publishScroll(Math.max(0, rawScrolled - barTriggerScroll), totalScroll > 0);
  }

  function requestRevealUpdate() {
    if (!revealTicking) {
      revealTicking = true;
      requestAnimationFrame(updateReveal);
    }
  }

  // Product image(s) riding the x-ray hand (inside revealXrayGroup, so each
  // reveals in lockstep with the wipe above) — built from this series' own
  // products, handed over by js/series.js once they load. Not a single fixed
  // element: any number of products can have "onHand.visible": true at once,
  // so this creates one <img class="reveal__ring"> per visible product
  // rather than assuming there's only ever one. Each one's position/size/
  // rotation comes from that SAME product's own onHand.x/y/scale/rotation (a
  // % of the hand image's own width/height, and degrees) — set as inline
  // custom properties on that specific <img>, not shared globally, so
  // multiple rings on screen at once don't fight over one set of values the
  // way hero.css's --ring-x/--ring-y/--ring-size/--ring-rotation
  // (fallback-only, see their own comment) would if applied to all at once.
  //
  // Deliberately gets the FULL product list, never a filtered one: the rings
  // on the hand are hero art, not a listing of what's currently on show.
  function updateHeroRings(products) {
    if (!revealXrayGroup) return;
    revealXrayGroup.querySelectorAll(".reveal__ring").forEach(function (existing) {
      existing.remove();
    });
    products.forEach(function (product) {
      var onHand = product.onHand;
      if (!onHand || !onHand.visible) return;
      var topShot = product.assets && product.assets["top-shot"] && product.assets["top-shot"][product.metal];
      if (!topShot) return;
      var ring = document.createElement("img");
      ring.className = "reveal__ring";
      ring.alt = "";
      ring.src = topShot;
      ring.style.setProperty("--ring-x", onHand.x + "%");
      ring.style.setProperty("--ring-y", onHand.y + "%");
      ring.style.setProperty("--ring-size", onHand.scale + "%");
      ring.style.setProperty("--ring-rotation", onHand.rotation + "deg");
      revealXrayGroup.appendChild(ring);
    });
  }

  window.EmjiveSeriesHero = {
    init: function () {
      revealSection = document.getElementById("revealSection");
      revealXrayGroup = document.getElementById("revealXrayGroup");
      revealNormal = revealSection ? revealSection.querySelector(".reveal__img--normal") : null;
      revealFrontier = document.getElementById("revealFrontier");
      // Fixed, so it visually sits (z-index 80) over whatever scrolls
      // underneath it — see the bar-trigger comment in updateReveal().
      siteHeader = document.querySelector(".site-header");

      if (!revealSection || !revealXrayGroup || !revealNormal || !revealFrontier) return;

      window.addEventListener("scroll", requestRevealUpdate, { passive: true });
      window.addEventListener("resize", requestRevealUpdate);
      updateReveal();
    },

    onProducts: updateHeroRings
  };
})();
