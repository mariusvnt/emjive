/* ==========================================================================
   em·ji·ve — landing-page scroll memory.

   Makes the browser's Back button return to the gallery EXACTLY where the
   visitor left it: right offset on the very first painted frame, no jump,
   no smooth-scroll travel, no blank hold.

   Why the browser can't do this itself. At first paint index.html is
   almost empty — #seriesHero is an empty div held open at 100svh by
   css/style.css, and #productGrid holds one "Loading specimens…" line. The
   real height only arrives after three async hops: data/series.json, then
   the hero bundle (whose hero.css sets .reveal { height: 200vh }), then
   that series' products.json rendered by js/main.js. Native scroll
   restoration runs long before any of that, against a document a fraction
   of its final height, so the offset clamps to near zero and the visitor is
   dumped at the top.

   The fix is to reserve the document's old height BEFORE the first paint,
   so the saved offset is reachable immediately, and to scroll to it inside
   a requestAnimationFrame callback — which runs before the frame it
   belongs to is painted. The visitor never sees a frame at the wrong
   position; they see the page background at the right offset, and the hero
   and grid materialise around them.

   Loaded BLOCKING from <head> (no defer, no type="module") for the same
   reason js/series.js is, plus one of its own: the height reservation has
   to be in place before <body> is parsed, which rules out defer.

   index.html ONLY. Every other page builds its height synchronously from
   markup, so the browser already restores those correctly and this would
   just be a second opinion fighting a working one.
   ========================================================================== */

(function () {
  "use strict";

  // Ancient browser with no history.scrollRestoration: leave the whole
  // thing to the UA rather than half-owning it (we'd suppress nothing and
  // it would still do its own clamped restore on top of ours).
  if (!("scrollRestoration" in window.history)) return;

  var STORAGE_PREFIX = "emjive:scroll:";
  var RESTORING_CLASS = "emjive-restoring-scroll";
  var HEIGHT_VAR = "--emjive-restore-height";

  // Hard cap on the whole restore window. Everything inside it is a
  // best-effort race against this: whatever hasn't landed by now, the page
  // is released as-is. On a real back-navigation every asset is already in
  // the HTTP cache and this finishes in a fraction of it.
  var DEADLINE_MS = 1200;
  // Grace period for the on-screen cards' placeholder images to decode
  // before the grid is revealed — see settle().
  var SETTLE_MS = 250;
  var SAVE_THROTTLE_MS = 300;

  // Stopping the re-assert loop, NOT ending the restore window — see
  // userTookOver's own comment.
  var TAKEOVER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"];

  var html = document.documentElement;

  function now() {
    return Date.now();
  }

  /* ---- per-history-entry key ---------------------------------------------
     Keyed off the history ENTRY, not the URL: a visitor can have two
     index.html entries in one session sitting at completely different
     offsets (scroll, open a product, back, scroll elsewhere, open another),
     and a URL key would let the second one overwrite the first. A token
     minted into history.state is per-entry by construction, and survives a
     traversal that re-fetches the document — session history keeps the
     state object even when the page itself is reloaded.

     Only the token lives in history.state. The position itself goes to
     sessionStorage, because saving it means writing on every scroll and
     Safari rate-limits replaceState (~100 calls / 30s) hard enough to start
     throwing.
     ----------------------------------------------------------------------- */
  var key = (function () {
    var state = null;
    try { state = window.history.state; } catch (e) { state = null; }
    if (state && state.emjiveScrollKey) return state.emjiveScrollKey;

    var minted = "s" + now().toString(36) + Math.random().toString(36).slice(2, 8);
    var next = {};
    if (state && typeof state === "object") {
      for (var k in state) {
        if (Object.prototype.hasOwnProperty.call(state, k)) next[k] = state[k];
      }
    }
    next.emjiveScrollKey = minted;
    try {
      // No third argument: the URL (including ?series=/?cat=/#products) is
      // left exactly as it is.
      window.history.replaceState(next, "");
    } catch (e) {
      // Can't persist the token, so a later traversal would mint a fresh
      // one and find nothing under it. Degrade to the browser's own
      // behaviour rather than pretending to remember.
      return null;
    }
    return minted;
  })();

  if (!key) return;

  function readSaved() {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.y > 0 ? parsed : null;
    } catch (e) {
      // sessionStorage throws outright in Safari private mode.
      return null;
    }
  }

  /* ---- saving ------------------------------------------------------------ */

  // The height is stored alongside the offset because that's what makes the
  // offset reachable again on the next load (see beginRestore) — without it
  // there's nothing to scroll within until the hero and grid have landed.
  function save() {
    if (restoring) return; // scrollY is mid-restore, not the visitor's
    try {
      window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({
        y: Math.round(window.pageYOffset || window.scrollY || 0),
        h: Math.round(html.scrollHeight)
      }));
    } catch (e) { /* private mode / quota — nothing to do */ }
  }

  var saveTimer = 0;
  function throttledSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      save();
    }, SAVE_THROTTLE_MS);
  }

  // pagehide is the one that matters and the only one iOS Safari fires
  // reliably on a real navigation away (beforeunload/unload are both
  // unreliable there, and an unload listener would additionally disqualify
  // the page from bfcache). visibilitychange covers app-switching, and the
  // throttled scroll listener is the safety net for a tab the OS kills
  // outright without either firing.
  window.addEventListener("pagehide", save);
  window.addEventListener("scroll", throttledSave, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") save();
  });

  /* ---- scrolling --------------------------------------------------------- */

  // css/style.css sets html { scroll-behavior: smooth }, which would make
  // this ANIMATE — i.e. exactly the visible "scrolling back to where you
  // were" this whole file exists to avoid. The inline override is the part
  // that actually guarantees it; behavior: "instant" is belt-and-braces for
  // anything that reads the argument instead of the computed style, and is
  // wrapped because a browser predating that enum value throws on it.
  function applyScroll(y) {
    var previous = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    try {
      window.scrollTo({ top: y, left: 0, behavior: "instant" });
    } catch (e) {
      window.scrollTo(0, y);
    }
    if (previous) html.style.scrollBehavior = previous;
    else html.style.removeProperty("scroll-behavior");
  }

  /* ---- the restore window ------------------------------------------------ */

  var restoring = false;
  // Set once the visitor touches the page. Stops the re-assert loop, but
  // deliberately does NOT end the restore window: the height reservation
  // has to stay until the real content has grown past it, or removing it
  // would collapse the document under them and yank the scroll — the exact
  // jerk this is meant to prevent, just triggered by their own input.
  var userTookOver = false;
  var contentReadyCalled = false;
  var targetY = 0;
  var reservedHeight = 0;
  var deadline = 0;
  var rafId = 0;

  function tallEnough() {
    return html.scrollHeight >= reservedHeight;
  }

  function expired() {
    return now() >= deadline;
  }

  function tick() {
    rafId = 0;
    if (!restoring) return;
    // document.body can still be null on the first frame or two — the head
    // script runs before the parser has reached <body>, and there's nothing
    // to scroll until there is.
    if (document.body && !userTookOver) applyScroll(targetY);
    if (expired()) {
      endRestore();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function endRestore() {
    if (!restoring) return;
    restoring = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    TAKEOVER_EVENTS.forEach(function (type) {
      window.removeEventListener(type, takeOver, true);
    });
    // Dropping the reservation is a no-op for layout by this point — the
    // real content has already met or exceeded it (settle() waits for
    // exactly that before getting here).
    html.classList.remove(RESTORING_CLASS);
    html.style.removeProperty(HEIGHT_VAR);
  }

  function takeOver() {
    userTookOver = true;
  }

  function beginRestore(entry) {
    restoring = true;
    targetY = entry.y;
    reservedHeight = entry.h || 0;
    deadline = now() + DEADLINE_MS;

    html.style.setProperty(HEIGHT_VAR, reservedHeight + "px");
    html.classList.add(RESTORING_CLASS);

    // Capture phase so a listener that stops propagation (the viewer's own
    // TrackballControls bind pointer events on the canvas) can't hide the
    // visitor's input from us.
    TAKEOVER_EVENTS.forEach(function (type) {
      window.addEventListener(type, takeOver, { passive: true, capture: true });
    });

    // Armed here rather than only inside tick(), so a JS error anywhere
    // else on the page can never leave the grid hidden behind a phantom
    // height forever.
    setTimeout(endRestore, DEADLINE_MS);

    tick();
  }

  /* ---- settling before the grid is revealed ------------------------------
     css/style.css keeps .product-grid visibility: hidden for the duration
     of the restore window. That's not a paint hold on the page — the
     background, the reserved height and (once it lands) the hero are all
     painted at the restored offset the whole time — it's just the grid
     waiting so its cards arrive complete rather than as a row of empty
     boxes that fill in a frame later.

     Everything here is a race against the deadline, so none of it can
     stall the page.
     ----------------------------------------------------------------------- */

  function timeout(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Polls rather than hooking the hero stylesheet's load event: the height
  // that matters is the document's, which is the sum of the injected hero
  // fragment, its stylesheet and the rendered grid all landing — one
  // measurable outcome instead of three separate signals to coordinate.
  function heightReady() {
    return new Promise(function (resolve) {
      (function check() {
        if (tallEnough() || expired()) return resolve();
        requestAnimationFrame(check);
      })();
    });
  }

  function decoded(img) {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    if (typeof img.decode === "function") {
      return img.decode().catch(function () { /* broken src is not our problem */ });
    }
    return new Promise(function (resolve) {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  }

  // The cards actually on screen at the restored offset, and only those.
  // Their placeholders are the "fallback-img" captures, framed to match the
  // live camera pixel-for-pixel (see buildCard in js/main.js), so a grid
  // revealed with these decoded reads as the settled page rather than as
  // something still loading. If the restored offset is still up in the hero
  // this finds nothing and resolves immediately.
  function visibleFigureImages() {
    var viewportHeight = window.innerHeight || 0;
    var all = document.querySelectorAll(".product-card__figure > img");
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var rect = all[i].getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < viewportHeight) out.push(decoded(all[i]));
    }
    if (document.fonts && document.fonts.ready) out.push(document.fonts.ready);
    return out;
  }

  function settle() {
    heightReady()
      .then(function () {
        if (!restoring) return;
        if (!userTookOver) applyScroll(targetY);
        return Promise.race([Promise.all(visibleFigureImages()), timeout(SETTLE_MS)]);
      })
      .then(function () {
        if (!restoring) return;
        // Two frames, not one: the first lets the hero's own scroll handler
        // (series/<slug>/hero.js, which schedules its clip-path update in a
        // rAF of its own) and js/selection-bar.js react to the restored
        // offset, so the x-ray wipe and the floating bar are already in the
        // right state on the frame the grid becomes visible.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (!userTookOver) applyScroll(targetY);
            endRestore();
          });
        });
      })
      .catch(endRestore);
  }

  /* ---- bfcache ------------------------------------------------------------
     A back-navigation that hits the back/forward cache never re-runs any of
     the above: the document, its layout and its height come back intact. It
     still needs the scroll applied, because scrollRestoration = "manual"
     opts out of the UA's traversal restore too. pageshow fires before the
     restored page's first frame, so setting it here is enough — there is
     nothing async to wait for.
     ----------------------------------------------------------------------- */
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    var entry = readSaved();
    if (entry) applyScroll(entry.y);
  });

  /* ---- go ----------------------------------------------------------------- */

  // Taken before anything is read, so the browser's own early (and
  // necessarily clamped — see this file's header) restore never fights
  // ours. Per-history-entry, so it doesn't leak to product.html et al.
  window.history.scrollRestoration = "manual";

  window.EmjiveScrollMemory = {
    isRestoring: function () { return restoring; },

    // Called by js/main.js the moment the grid has been rendered and
    // filtered — the last thing that changes the document's height.
    contentReady: function () {
      if (contentReadyCalled) return;
      contentReadyCalled = true;
      if (!restoring) return;
      if (!userTookOver) applyScroll(targetY);
      settle();
    }
  };

  var savedEntry = readSaved();
  if (savedEntry) beginRestore(savedEntry);
})();
