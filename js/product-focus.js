/* ==========================================================================
   J&MV — product focus + snap scrolling (homepage grid only)

   Turns the grid into a one-item-per-gesture filmstrip: every scroll step
   settles exactly one product on the screen's center, which is where the
   fixed lens sits (see css/style.css's lens geometry block). Publishes
   which product that is via window.EmjiveFocus, the same plain
   function-registry shape window.EmjiveHero uses in js/series.js — not a
   CustomEvent, for the same reason stated there, and so a late subscriber
   is handed the current value immediately on registering rather than
   waiting for the next change.

   Snapping deliberately does NOT extend up into the hero's own scroll
   range — the hero owns a ~200vh scroll-driven wipe (see the active
   series' hero.js) that has to stay freely scrubbable, so every handler
   below no-ops once the page is above the first card. The one edge that
   IS snapped is the seam itself: scrolling up off the first product snaps
   back down to the boundary (see goToHero()/heroTargetScroll()), the
   mirror of the settle logic below that catches a downward arrival onto
   that same first product.
   ========================================================================== */

(function () {
  "use strict";

  var grid = document.getElementById("productGrid");
  if (!grid) return;

  // Mirrors js/lens-artefact.js's own reference to the same element — see
  // heroTargetScroll() below for why.
  var heroSlot = document.getElementById("seriesHero");

  // Ignore the sub-pixel wheel noise a trackpad emits between real gestures.
  var WHEEL_MIN_DELTA = 4;
  var TOUCH_MIN_DELTA = 30;
  // How long after the last scroll event the page counts as "settled".
  var SETTLE_MS = 140;
  // The snap itself is hand-animated rather than handed to
  // scrollTo({behavior:"smooth"}), purely so this duration and curve are
  // ours to set — the native smooth scroll exposes neither, and its pace is
  // far too brisk for a specimen sliding under a lens.
  var SNAP_DURATION_MS = 850;
  // Safety net only: the tween below always unlocks itself on its final
  // frame, so this just covers a tween that never gets to finish (a
  // backgrounded tab dropping rAF, say) rather than being the normal path.
  var LOCK_FALLBACK_MS = SNAP_DURATION_MS + 400;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---- position persistence (back/forward navigation) --------------------- */

  // sessionStorage, not localStorage: a per-tab "where was I" breadcrumb,
  // the same lifetime as browser history itself — not something that should
  // survive into a brand new tab or a return visit days later.
  var STORAGE_KEY = "emjive_grid_position";

  // Read once, at script init — this is what "arrived via the browser's
  // back button" looks like from here: whatever this file wrote to
  // sessionStorage right before the visitor navigated away (see the
  // pagehide listener below) is still sitting there when index.html loads
  // again. Cleared as soon as it's consumed by a real gesture (see
  // clearPendingRestore below) — it exists to survive exactly one page
  // load, not to keep pulling the visitor back to an old position forever.
  var pendingRestore = null;
  try {
    var savedRaw = sessionStorage.getItem(STORAGE_KEY);
    if (savedRaw) {
      var saved = JSON.parse(savedRaw);
      if (saved && saved.id) pendingRestore = saved;
    }
  } catch (e) { /* sessionStorage unavailable (private mode, etc.) — no restore */ }

  function clearPendingRestore() {
    pendingRestore = null;
  }

  // Deliberately sticky rather than one-shot: tried again on every settle
  // opportunity (including the hero-bundle-landed corrections below) until
  // either it succeeds and the visitor then gestures for real, or it's
  // given up on for this call because entries don't contain a match yet.
  // A one-shot attempt made right at page load would race the hero bundle
  // — index.html reserves only a single viewport's height for it up front,
  // real height (several viewports) lands later once its stylesheet
  // arrives — and could compute a scroll target against the wrong, still-
  // collapsed layout. Reusing the same "keep correcting until it's right"
  // pattern the resize/load handling below already relies on sidesteps that
  // race entirely rather than trying to win it once.
  function applyPendingRestore() {
    if (!pendingRestore || !entries.length) return false;
    if (pendingRestore.series && window.EmjiveSeries && window.EmjiveSeries.slug &&
        pendingRestore.series !== window.EmjiveSeries.slug) {
      // A different series is active now (e.g. the URL's ?series= changed
      // between visits) — this saved position doesn't apply here.
      clearPendingRestore();
      return false;
    }
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].product && entries[i].product.id === pendingRestore.id) {
        setIndex(i);
        jumpTo(targetScrollFor(i));
        // Instant and settled immediately — "instantly come back to this
        // point" is the whole ask, not a scroll-triggered re-arrival.
        publishSettled();
        return true;
      }
    }
    // Not found (filtered out by an active ?cat=, say) — leave pendingRestore
    // in place in case a later grid rebuild (a filter toggling back) makes it
    // findable again; harmless to keep checking, and cheap at this scale.
    return false;
  }

  // Saved on every departure from this page, not just a click through to a
  // product: pagehide is the one event that reliably fires for both a real
  // navigation and a bfcache-eligible one, and firing unconditionally (not
  // just from wireModelClickNavigation et al.) means the position is always
  // current, however the visitor actually left.
  window.addEventListener("pagehide", function () {
    var product = currentProduct();
    try {
      if (!product) {
        // Left from the hero (nothing focused) — no position to restore to
        // beyond the page's own default, so don't leave a stale one behind.
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        id: product.id,
        series: window.EmjiveSeries && window.EmjiveSeries.slug
      }));
    } catch (e) { /* sessionStorage unavailable — nothing to do */ }
  });

  var entries = [];   // visible [{ product, el }], in document order
  var index = -1;     // focused position in `entries`, or -1 for "none"
  var locked = false; // a snap animation owns the scroll position right now
  var lockTimer = null;
  var settleTimer = null;
  var subscribers = [];
  var settledSubscribers = [];
  // -1 up / +1 down / 0 unknown — the gesture that produced the scroll
  // we're about to settle from. Read by resolveFocus() below, which has to
  // tell "deliberately leaving the strip upward" apart from "drifting in".
  var lastDirection = 0;

  // A light exponential-moving-average estimate of the page's own scroll
  // speed (px/ms), sampled on every scroll event. Its only consumer is a
  // corrective (not gesture-driven) snap — see hermiteEaseTo1 above — which
  // needs to know how fast the page was already moving at the instant it
  // takes over, so the takeover doesn't read as a sudden stop.
  var scrollVelocity = 0;
  var lastVelocityY = window.scrollY;
  var lastVelocityT = performance.now();

  function trackVelocity() {
    var now = performance.now();
    var dt = now - lastVelocityT;
    if (dt > 0) {
      var instant = (window.scrollY - lastVelocityY) / dt;
      scrollVelocity = scrollVelocity * 0.6 + instant * 0.4;
    }
    lastVelocityY = window.scrollY;
    lastVelocityT = now;
  }

  function currentProduct() {
    return index >= 0 && entries[index] ? entries[index].product : null;
  }

  function publish() {
    var product = currentProduct();
    for (var i = 0; i < subscribers.length; i++) subscribers[i](product, index);
  }

  function publishSettled() {
    var product = currentProduct();
    for (var i = 0; i < settledSubscribers.length; i++) settledSubscribers[i](product, index);
  }

  window.EmjiveFocus = {
    // Fires the moment focus changes — i.e. when the strip STARTS moving.
    onChange: function (fn) {
      if (typeof fn !== "function") return;
      subscribers.push(fn);
      fn(currentProduct(), index);
    },
    // Fires when the strip has come to rest on that product. Separate from
    // onChange because the lens needs both moments and they're far apart:
    // it starts showing the magnified still on the first, and is only
    // allowed to hand over to the live model on the second.
    onSettled: function (fn) {
      if (typeof fn !== "function") return;
      settledSubscribers.push(fn);
      if (!locked && index >= 0) fn(currentProduct(), index);
    },
    // The visible cards, in order, each paired with its product — what the
    // lens lays its magnified duplicate of the stack out from.
    entries: function () { return entries.slice(); },
    // The brand logo's click handler (js/main.js) — always wins over
    // whatever the strip is doing, however far into a snap it is.
    // animateScrollTo() below cancels the in-flight tween itself (same as
    // every goTo()); clearing pendingRestore here on top of that is the
    // one thing goTo() doesn't need — a settle firing after this must not
    // be allowed to drag the page back down to a stale saved position.
    goHome: function () {
      clearPendingRestore();
      locked = true;
      if (lockTimer) clearTimeout(lockTimer);
      lockTimer = setTimeout(unlock, LOCK_FALLBACK_MS);
      setIndex(-1);
      animateScrollTo(0, 0);
    }
  };

  /* ---- geometry ---------------------------------------------------------- */

  // Where the page must be scrolled to for card i's center to sit on the
  // viewport's center. Measured live off getBoundingClientRect rather than
  // cached: the hero above the grid changes height with the viewport, and
  // filtering removes whole cards from the flow.
  function targetScrollFor(i) {
    var rect = entries[i].el.getBoundingClientRect();
    var center = rect.top + window.scrollY + rect.height / 2;
    var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    return Math.max(0, Math.min(center - window.innerHeight / 2, maxScroll));
  }

  // Where the page must be scrolled to for the hero to read as "in view,
  // toward the x-ray hand" — the exact same boundary js/lens-artefact.js's
  // syncGlass() already tests live (heroSlot's bottom edge on the
  // viewport's vertical middle), just solved for the scrollY that puts it
  // there instead of read as a live true/false. That file's own comment
  // already frames crossing it upward as "scrolling back up toward the
  // x-ray hand" — this reuses that same, already-established measurement
  // rather than reaching for something series-specific (an actual x-ray
  // element id) that a future series' hero might not even have.
  function heroTargetScroll() {
    if (!heroSlot) return 0;
    var rect = heroSlot.getBoundingClientRect();
    return Math.max(0, window.scrollY + rect.bottom - window.innerHeight / 2);
  }

  function nearestIndex() {
    var middle = window.innerHeight / 2;
    var best = 0;
    var bestDistance = Infinity;
    for (var i = 0; i < entries.length; i++) {
      var rect = entries[i].el.getBoundingClientRect();
      var distance = Math.abs(rect.top + rect.height / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  // True once the page has reached the strip. Everything above this point
  // is the hero's own scroll range and is left completely alone.
  function inStrip() {
    return entries.length > 0 && window.scrollY >= targetScrollFor(0) - 1;
  }

  /* ---- focus state ------------------------------------------------------- */

  function setIndex(next) {
    if (next === index) return;
    if (index >= 0 && entries[index]) entries[index].el.classList.remove("is-focused");
    index = next;
    if (index >= 0 && entries[index]) entries[index].el.classList.add("is-focused");
    publish();
  }

  function unlock() {
    locked = false;
    if (lockTimer) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
  }

  /* ---- the snap tween ---------------------------------------------------- */

  var animFrame = null;
  var animFrom = 0;
  var animTo = 0;
  var animStart = 0;
  var animTangent = 0; // 0 for a deliberate gesture-driven snap (see goTo)

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // A cubic Hermite spline from 0 to 1 with initial tangent m0 (the fraction
  // of the whole distance it would cover per unit t, were that rate to hold)
  // and zero tangent at the end — i.e. it MATCHES an incoming velocity, then
  // eases to a natural stop. m0 = 0 degenerates to a plain smoothstep, close
  // in shape to easeInOutCubic above.
  //
  // This exists for one reason: the entrance into the strip (and any
  // mid-fling recapture — see runCapture) interrupts scrolling that was
  // already moving, often fast, off the tail of the hero's long scroll
  // region. Starting the snap tween from a standing start (easeInOutCubic's
  // own velocity at t=0 is exactly zero) reads as slamming the brakes right
  // at the moment control changes hands. Matching the incoming velocity
  // instead makes the snap a continuation of the scroll already in motion,
  // not an interruption of it.
  //
  // Verified numerically (not just asserted) that this stays monotone and
  // never overshoots past 1 for m0 up to ~3 — see the clamp below, which
  // stays well inside that margin.
  function hermiteEaseTo1(t, m0) {
    var t2 = t * t;
    var t3 = t2 * t;
    return m0 * (t3 - 2 * t2 + t) + (-2 * t3 + 3 * t2);
  }

  // "instant", not "auto": html carries `scroll-behavior: smooth` (see the
  // base rules in css/style.css), and "auto" defers to it — which would set
  // the browser's own smooth scroll running against this tween, one fighting
  // the other every frame.
  function jumpTo(top) {
    window.scrollTo({ top: top, behavior: "instant" });
  }

  function cancelAnim() {
    if (animFrame !== null) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
  }

  function animTick(now) {
    if (!animStart) animStart = now;
    var t = Math.min(1, (now - animStart) / SNAP_DURATION_MS);
    var eased = animTangent ? hermiteEaseTo1(t, animTangent) : easeInOutCubic(t);
    jumpTo(animFrom + (animTo - animFrom) * eased);
    if (t < 1) {
      animFrame = requestAnimationFrame(animTick);
      return;
    }
    animFrame = null;
    unlock();
    publishSettled();
  }

  // tangent (optional) is the incoming scroll velocity expressed as
  // "fraction of this tween's distance, per unit t" — see hermiteEaseTo1.
  // Omitted (0) for a deliberate single-gesture step, where starting from
  // rest is the correct, expected feel of a discrete "go to next" command.
  function animateScrollTo(top, tangent) {
    cancelAnim();
    if (reduceMotion.matches) {
      jumpTo(top);
      unlock();
      publishSettled();
      return;
    }
    animFrom = window.scrollY;
    animTo = top;
    animStart = 0;
    animTangent = tangent || 0;
    animFrame = requestAnimationFrame(animTick);
  }

  // tangent: see animateScrollTo. Only ever passed by the corrective paths
  // below (runCapture, resolveFocus) that are taking over a scroll already
  // in motion; every gesture handler calls this with none.
  function goTo(next, tangent) {
    if (next < 0 || next >= entries.length) return false;
    locked = true;
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(unlock, LOCK_FALLBACK_MS);
    // Focus changes up front, not on arrival: the lens label and magnified
    // viewer are meant to start leaving the moment the strip starts moving,
    // so the outgoing product is never left captioned under the new one.
    setIndex(next);
    var target = targetScrollFor(next);
    var distance = target - window.scrollY;
    // In matching direction and within the range verified monotone/no-
    // overshoot (see hermiteEaseTo1's comment) — otherwise this is a
    // deliberate step (tangent omitted) or the incoming motion doesn't
    // actually help (wrong direction, or too fast to trust), so fall back
    // to a standing start rather than risk a visible dip or overshoot.
    var m0 = 0;
    if (tangent && distance !== 0) {
      var raw = (tangent * SNAP_DURATION_MS) / distance;
      if (raw > 0) m0 = Math.min(raw, 2);
    }
    animateScrollTo(target, m0);
    return true;
  }

  // goTo()'s counterpart for the strip's own top edge: scrolling up off the
  // first product snaps back to the hero boundary (heroTargetScroll()),
  // mirroring how a downward arrival out of the hero snaps onto the first
  // product. No tangent — same standing-start feel every other discrete
  // gesture-driven snap already uses (see goTo()'s own comment).
  function goToHero() {
    locked = true;
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(unlock, LOCK_FALLBACK_MS);
    setIndex(-1);
    animateScrollTo(heroTargetScroll(), 0);
    return true;
  }

  // Shared by every input. Four outcomes:
  //   "free"    — not ours; hand it to the browser untouched (still in the
  //               hero — index is -1 there, already released, nothing left
  //               for a further upward gesture to do).
  //   "hero"    — ours; scrolling up off the first product snaps back to
  //               the hero boundary rather than releasing to free scroll.
  //   "absorb"  — ours, and the answer is "nothing happens": swallow the
  //               gesture at the end of the strip so the page can't drift
  //               into the empty run-off below and spring back.
  //   "advance" — ours; move one product.
  function gestureMode(direction) {
    if (!entries.length || !inStrip()) return "free";
    if (direction < 0 && index === 0) return "hero";
    if (direction < 0 && index < 0) return "free";
    if (direction > 0 && index >= entries.length - 1) return "absorb";
    return "advance";
  }

  /* ---- input ------------------------------------------------------------- */

  function onWheel(e) {
    if (!entries.length || Math.abs(e.deltaY) < WHEEL_MIN_DELTA) return;
    var direction = e.deltaY > 0 ? 1 : -1;
    // Recorded before the release check below, precisely so the gesture that
    // hands control BACK to the browser is the one resolveFocus() sees.
    lastDirection = direction;
    var mode = gestureMode(direction);
    if (mode === "free") return;
    // Held even while locked, so a trackpad's long momentum tail can't
    // free-scroll the strip out from under an in-flight snap.
    e.preventDefault();
    if (mode === "absorb" || locked) return;
    clearPendingRestore();
    if (mode === "hero") goToHero();
    else goTo(index + direction);
  }

  var touchStartY = null;
  var touchArmed = false;

  function onTouchStart(e) {
    // A drag starting on the magnified model is the model's own rotate
    // gesture (TrackballControls) — never the strip's.
    if (e.touches.length !== 1 || (e.target.closest && e.target.closest(".lens-viewer"))) {
      touchArmed = false;
      return;
    }
    touchStartY = e.touches[0].clientY;
    touchArmed = true;
  }

  function onTouchMove(e) {
    if (!touchArmed || !entries.length) return;
    var delta = touchStartY - e.touches[0].clientY; // swipe up = advance
    var direction = delta > 0 ? 1 : -1;
    lastDirection = direction;
    var mode = gestureMode(direction);
    if (mode === "free") return;
    e.preventDefault();
    if (mode === "absorb" || locked || Math.abs(delta) < TOUCH_MIN_DELTA) return;
    clearPendingRestore();
    if (mode === "hero") goToHero();
    else goTo(index + direction);
    touchArmed = false; // one product per swipe, however far it travels
  }

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;

    var direction = 0;
    if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") direction = 1;
    else if (e.key === "ArrowUp" || e.key === "PageUp") direction = -1;
    else return;

    lastDirection = direction;
    var mode = gestureMode(direction);
    if (mode === "free") return;
    e.preventDefault();
    if (mode === "absorb" || locked) return;
    clearPendingRestore();
    if (mode === "hero") goToHero();
    else goTo(index + direction);
  }

  /* ---- settling ---------------------------------------------------------- */

  // What should be focused at the page's current scroll position. The
  // direction that got us here matters, and is why this isn't just
  // "nearest card wins": scrolling up off the first product is a deliberate
  // exit back into the hero and must NOT be re-captured (otherwise the
  // strip's first item is a trap — the release scrolls, then the settle
  // immediately drags it back), while drifting DOWN out of the hero should
  // latch onto that same first product from a little way out, so arriving
  // fast doesn't coast straight past it.
  function resolveFocus(direction) {
    if (!entries.length) {
      setIndex(-1);
      return -1;
    }
    var above = targetScrollFor(0) - window.scrollY;
    if (above > 1 && (direction < 0 || above > window.innerHeight * 0.5)) {
      setIndex(-1);
      return -1;
    }
    var nearest = nearestIndex();
    setIndex(nearest);
    return nearest;
  }

  // Catches every way the page can move that isn't one of the gestures above
  // — a scrollbar drag, a fragment jump, an interrupted smooth scroll,
  // arriving out of the hero — and re-seats the nearest product. Also what
  // hands focus over on the way in from the hero, so entering the strip
  // settles onto the first product instead of coasting through it.
  // lastDirection is deliberately NOT cleared here. It stays valid until the
  // next real gesture overwrites it, because a single release can settle
  // more than once (the debounce below and `scrollend` both land on this) —
  // and if the second pass saw direction 0 it would re-capture the exit
  // scroll it was supposed to be letting go of.
  function onSettle() {
    if (locked) return;
    // Takes priority over the normal nearest-card resolution below for as
    // long as it's pending — see applyPendingRestore's own comment for why
    // that has to be "every settle, sticky" rather than a single attempt.
    if (pendingRestore && applyPendingRestore()) return;
    var nearest = resolveFocus(lastDirection);
    if (nearest < 0) return;
    // tangent from the live velocity estimate: by the time onSettle fires
    // (140ms of no further scroll events) the page has usually genuinely
    // stopped, so this is normally ~0 and a no-op — but the entrance case
    // (arriving out of the hero) can land here directly too, still carrying
    // real speed, and that's exactly the "harsh first snap" this smooths.
    if (Math.abs(window.scrollY - targetScrollFor(nearest)) > 2) goTo(nearest, scrollVelocity);
    // Already sitting on it — this is the arrival, so the lens is clear to
    // hand over to the live model. Covers every route in that doesn't go
    // through the tween: a scrollbar drag, a reduced-motion jump, a reload
    // partway down the strip.
    else publishSettled();
  }

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("keydown", onKeyDown);

  function scheduleSettle() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(onSettle, SETTLE_MS);
  }

  // Why waiting for the settle isn't enough on its own: once a fling has
  // begun scrolling the document, Chrome stops honouring preventDefault()
  // on the rest of that gesture's wheel events (scroll latching). A flick
  // started in the hero therefore carries straight on through the strip,
  // ignoring every handler above, and only gets tidied up once it stops —
  // which is the "sometimes it doesn't snap and I scroll right past
  // everything" case. So the strip also grabs control the moment it notices
  // the page has drifted, mid-scroll, instead of only at the end of one.
  var captureTicking = false;

  function runCapture() {
    captureTicking = false;
    if (locked || !entries.length || !inStrip()) return;
    var nearest = nearestIndex();
    var drift = Math.abs(window.scrollY - targetScrollFor(nearest));
    // A third of a card: past that the page is visibly between products
    // rather than merely a few pixels off one.
    var tolerance = entries[nearest].el.getBoundingClientRect().height / 3;
    // index < 0 means the strip was entered without any gesture of ours
    // being honoured — exactly the latched-fling case — so take it straight
    // away rather than waiting for drift to build. Carries the live
    // velocity estimate: this is precisely the moment a fast, uninterrupted
    // scroll gets taken over, so it's the one most likely to otherwise read
    // as an abrupt stop.
    if (index < 0 || drift > tolerance) goTo(nearest, scrollVelocity);
  }

  function onScroll() {
    trackVelocity();
    scheduleSettle();
    if (captureTicking) return;
    captureTicking = true;
    requestAnimationFrame(runCapture);
  }

  window.addEventListener("scroll", onScroll, { passive: true });

  // Clicking any product in the stack brings it under the lens. Ignores the
  // per-card link (visually hidden, but still the real navigation for
  // keyboard and crawlers) so that keeps its own behaviour.
  grid.addEventListener("click", function (e) {
    if (!e.target.closest || e.target.closest(".product-card__label")) return;
    var card = e.target.closest(".product-card");
    if (!card) return;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].el !== card) continue;
      if (i === index) return; // already the focused one — let the lens have it
      e.preventDefault();
      clearPendingRestore();
      goTo(i);
      return;
    }
  });

  // Unlocks a scroll this file didn't start (a scrollbar drag, a flung
  // free-scroll off either end) as soon as it lands. Guarded on the tween
  // NOT running: the tween scrolls instantly once per frame, which the
  // browser can legitimately read as a scroll finishing between frames —
  // without that guard it fires scrollend mid-animation and unlocks the
  // gesture halfway through the snap. Re-schedules rather than settling
  // inline so there stays exactly ONE path that can trigger a corrective
  // snap; calling onSettle() directly here raced the debounced one and
  // double-resolved a single release.
  if ("onscrollend" in window) {
    window.addEventListener("scrollend", function () {
      if (animFrame === null && locked) unlock();
      scheduleSettle();
    });
  }

  window.addEventListener("resize", function () {
    // Card heights are viewport-derived, so every snap position moved.
    if (locked || index < 0) return;
    jumpTo(targetScrollFor(index));
  });

  // Everything below the hero moves when the hero bundle lands — its
  // stylesheet is what gives the hero its real, several-viewports-tall
  // height, replacing the single-viewport box index.html reserves — and
  // moves again as late images resolve. Either shifts every snap position
  // out from under whatever was computed before, so re-settle once things
  // have stopped moving. Safe to do unconditionally: resolveFocus() still
  // declines to focus anything if the page is left up in the hero, so this
  // can only correct a stale position, never invent one.
  window.addEventListener("load", scheduleSettle);
  if (window.EmjiveSeries && window.EmjiveSeries.ready) {
    window.EmjiveSeries.ready.then(scheduleSettle, scheduleSettle);
  }

  // js/main.js owns building the cards and announces every change to which
  // ones are visible (initial render and each category-filter toggle both
  // funnel through its applyFilter()).
  function adoptGrid(all) {
    all = all || [];
    for (var i = 0; i < all.length; i++) all[i].el.classList.remove("is-focused");
    entries = all.filter(function (entry) { return !entry.el.hidden; });
    index = -1;

    if (pendingRestore && applyPendingRestore()) return;

    // Through resolveFocus(), not straight to the nearest card: on first
    // render the page is still at the top of the hero, and "nearest" there
    // is card 0 — which would light the lens label up over the hero before
    // the visitor has scrolled anywhere near the grid.
    resolveFocus(0);
    // resolveFocus() only publishes when the index actually changes, and it
    // was just reset to -1 above; publish anyway so subscribers can't be
    // left holding a product from the previous (pre-filter) set.
    if (index === -1) publish();
  }

  window.addEventListener("emjive:grid-changed", function (e) {
    adoptGrid(e.detail && e.detail.entries);
  });

  // The grid may already have rendered before this script ran — see the
  // comment on window.EmjiveGrid in js/main.js. Without this the warm-cache
  // case leaves the strip permanently empty and the page scrolls freely.
  if (window.EmjiveGrid) adoptGrid(window.EmjiveGrid.entries);
})();
