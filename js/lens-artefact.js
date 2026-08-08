/* ==========================================================================
   J&MV — the lab-lens

   Owns all three fixed layers of the lens (see css/style.css's lens block):
   the glass render itself, the magnified view inside it, and the label bar
   hanging off its right edge. Two independent inputs drive them:

     window.EmjiveFocus (js/product-focus.js) -> which product is centered,
                                                driving the viewer and label;
                                                and, the instant it settles
                                                on the first product, the
                                                trigger for the glass's own
                                                60-frame extend, paced to
                                                finish its main motion in the
                                                same span as that snap (see
                                                enterGrid()).
     the hero's own geometry                 -> a fallback forward trigger
                                                for a grid with no visible
                                                products (EmjiveFocus never
                                                fires one there); and the
                                                authoritative trigger for the
                                                reverse — the same sequence
                                                played backward on scrolling
                                                back up into the hero.

   The magnified view is a duplicate of the product stack, drawn at
   --lens-mag about the screen's centre and clipped to the glass: one still
   per product, plus ONE live 3D viewer, positioned by the very same maths.

   Two rules shape everything below.

   1. The viewer is drawn where its PRODUCT is, not where the glass is. A
      model the visitor has set spinning therefore travels out of the glass
      under its own steam, still rendering and still spinning. An earlier
      design pinned it to the glass and swapped it for a still on the way
      out — but a still cannot roll, so any release inertia died the instant
      the swap happened.

   2. A swap between the live model and its still is only ever made when the
      two are indistinguishable: same product, same default pose, same size.
      That's why a departing model is first eased back to its default pose
      (returnToDefaultPose) and only handed over once it gets there, and why
      an arriving one is only shown once it has painted. Nothing is ever
      substituted while the difference could be seen.

   There is exactly ONE viewer for the life of the page, reused across
   products via handle.loadProduct(). It used to be built and disposed per
   product, which cost a new WebGL context plus a full HDR decode and PMREM
   generation every scroll step — ~180ms of blocked main thread, landing as
   a dropped frame mid-animation. Reusing the renderer keeps its environment
   map, leaving only the glTF load; and that load is deferred until the
   strip has stopped, so nothing heavy runs while anything is moving.
   ========================================================================== */

(function () {
  "use strict";

  var glass = document.getElementById("lensArtefact");
  var viewerHost = document.getElementById("lensViewer");
  var magHost = document.getElementById("lensMag");
  var labelEl = document.getElementById("lensLabel");
  var labelName = document.getElementById("lensLabelName");
  var labelType = document.getElementById("lensLabelType");

  if (!glass) return;

  /* ---- the glass ---------------------------------------------------------- */

  // Measured off the hero slot directly rather than subscribed to
  // window.EmjiveHero. EmjiveHero publishes how far past the hero's own
  // trigger point the page has scrolled, but that trigger is calibrated to
  // something else entirely — the frontier band clearing the fixed header,
  // which happens while the whole revealed x-ray hand is still filling the
  // screen. Keying the lens to it made the glass appear over the hero
  // artwork. The hero's bottom edge crossing the middle of the screen is
  // the real "the hero is behind us now" moment, and being a plain
  // measurement it's symmetric for free: scrolling back up toward the x-ray
  // hand hides the glass again at exactly the same point.
  var heroSlot = document.getElementById("seriesHero");
  var glassTicking = false;
  var glassWasPast = false;
  // Guards the very first syncGlass() call (page load): it must snap
  // straight to the right frame, never animate — otherwise a reload that
  // restores an already-scrolled-past-the-boundary position (see
  // js/product-focus.js's sessionStorage["emjive_grid_position"]) would
  // replay the whole extend sequence on every refresh instead of just
  // showing the settled glass.
  var glassInited = false;
  // Has the forward extend already been kicked off for THIS "past"
  // session? Guards against double-triggering: entering the grid can be
  // signalled by two independent sources below (EmjiveFocus.onChange's
  // snap-to-first-item, the primary trigger; syncGlass's own hero-geometry
  // boundary, a fallback for a grid with no visible products, where
  // onChange never fires a real one) — whichever notices first wins, the
  // other becomes a no-op via enterGrid()'s own guard.
  var glassEntered = false;
  // Has the glass actually reached its last frame for THIS "past" session?
  // Read by the wiring section below to decide whether a focused product's
  // label may present immediately or has to wait — see
  // revealMagnifiedContent().
  var glassRevealReady = false;

  /* The 60-frame extend/retract sequence: a hand-authored "lens
     progressively extends in place" render, 60 frames @ 30fps, re-rendered
     once already (the disc's own geometry — --lens-disc-d/-r's ratios in
     css/style.css — happened to come out identical the second time, so no
     CSS change was needed alongside this one). Frame 60 is deliberately not
     a file of its own here — it's already wired up as assets/lab-lens.webp
     (index.html's #lensArtefact src), so the fully-extended, settled state
     is just that plain static image, exactly as it was before this
     sequence existed, with nothing left running once it's reached.

     Frame 60 is THE sync mark, revised from an earlier version of this
     render that visibly settled by around frame 45 — this one keeps moving
     (a bounce/wobble, confirmed by inspecting its alpha content) well past
     that point, so the magnified viewer/label now wait for the very last
     frame instead. The whole 1->60 span is timed as one entrance, paced to
     js/product-focus.js's own snap-to-first-item tween (SNAP_DURATION_MS
     below, mirrored by hand — see its comment) rather than to the clip's
     own raw length — see enterGrid(). */
  var GLASS_FRAME_COUNT = 60;
  var GLASS_NATIVE_FRAME_MS = 1000 / 30; // the clip's own authored rate —
                                          // only the retreat plays at this;
                                          // see enterGrid() for the entrance
  // js/product-focus.js's SNAP_DURATION_MS. No shared module system exists
  // between these two plain scripts to import it for real, so it's mirrored
  // here by hand — same as DEPART_RESET_MS's own comment below already
  // hand-mirrors this exact number for the same reason.
  var SNAP_DURATION_MS = 850;
  // The rate the entrance (1 -> GLASS_FRAME_COUNT) plays at: whatever's
  // needed for that FULL span to take exactly SNAP_DURATION_MS. Faster than
  // the clip's own native rate — a deliberate retiming to match the snap,
  // not an oversight.
  var GLASS_ENTER_FRAME_MS = SNAP_DURATION_MS / (GLASS_FRAME_COUNT - 1);
  var glassFrame = GLASS_FRAME_COUNT; // which frame # is currently in glass.src
  var glassToken = 0; // bumped on every playGlass() call — same idiom as
                       // loadToken below — so a crossing that reverses
                       // direction mid-animation invalidates the in-flight
                       // rAF loop rather than racing it

  function glassFramePath(n) {
    return n === GLASS_FRAME_COUNT
      ? "assets/lab-lens.webp"
      : "assets/lab-lens-frames/lab-lens_" + (n < 10 ? "0" + n : n) + ".webp";
  }

  // Buffered at load time, not lazily on approach to the boundary: eager,
  // plain preload (not <link rel=preload>, which would compete with the
  // hero's own critical preloads for bandwidth this sequence doesn't need
  // until well into the scroll), kicked off unconditionally the instant
  // this script runs. References kept alive in this array so later src
  // swaps on the visible glass paint instantly from cache rather than
  // re-fetching mid-animation.
  var glassPreload = [];
  for (var gp = 1; gp <= GLASS_FRAME_COUNT; gp++) {
    var preloadImg = new Image();
    preloadImg.src = glassFramePath(gp);
    glassPreload.push(preloadImg);
  }

  function setGlassFrame(n) {
    if (n === glassFrame) return;
    glassFrame = n;
    glass.src = glassFramePath(n);
  }

  // Animates from wherever the sequence currently sits to `target` over
  // `durationMs`, calling `onComplete` (if given) once it arrives — or
  // immediately, if it's already there. A fresh call always wins over one
  // already in flight via the token bump, same pattern loadToken uses below
  // for a stale glTF load — so a crossing that reverses direction
  // mid-animation resumes from the CURRENT frame rather than restarting or
  // jumping, and its superseded onComplete never fires.
  function playGlass(target, durationMs, onComplete) {
    var token = ++glassToken;
    var from = glassFrame;
    if (target === from) {
      if (onComplete) onComplete();
      return;
    }
    var start = null;

    function tick(now) {
      if (token !== glassToken) return; // superseded by a newer crossing
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / durationMs);
      setGlassFrame(Math.round(from + (target - from) * t));
      if (t < 1) {
        requestAnimationFrame(tick);
      } else if (onComplete) {
        onComplete();
      }
    }
    requestAnimationFrame(tick);
  }

  // The forward entrance: plays 1 -> GLASS_FRAME_COUNT at the rate that
  // makes a FULL run of it take exactly SNAP_DURATION_MS (a partial one,
  // resuming mid-retreat, takes proportionally less — same interrupt
  // handling as playGlass itself), revealing the magnified content the
  // instant it lands on the last frame. Idempotent per "past" session via
  // glassEntered, since two independent signals can each call this around
  // the same moment — see its declaration above.
  function enterGrid() {
    if (glassEntered) return;
    glassEntered = true;
    var toEnd = Math.abs(GLASS_FRAME_COUNT - glassFrame);
    playGlass(GLASS_FRAME_COUNT, toEnd * GLASS_ENTER_FRAME_MS, revealMagnifiedContent);
  }

  function syncGlass() {
    glassTicking = false;
    // No hero on this page (or the bundle failed to load, leaving the slot
    // empty): nothing to stay clear of, so the lens is simply available.
    var past = !heroSlot || heroSlot.getBoundingClientRect().bottom <= window.innerHeight / 2;

    if (!glassInited) {
      glassInited = true;
      setGlassFrame(past ? GLASS_FRAME_COUNT : 1);
      glass.classList.add("is-visible"); // one-time FOUC release — see css/style.css
      if (viewerHost) viewerHost.classList.toggle("is-visible", past);
      glassEntered = past;
      glassRevealReady = past;
      glassWasPast = past;
      if (past) layoutLens();
      return;
    }

    if (past && !glassWasPast) {
      // The real trigger is EmjiveFocus.onChange, below in the wiring
      // section — it fires in the same synchronous call js/product-focus.js
      // starts its own snap-to-first-item tween in, which is what
      // enterGrid()'s timing is actually paced against. This is only the
      // fallback, for a grid with zero visible products, where onChange
      // never fires a real one.
      enterGrid();
    } else if (!past && glassWasPast) {
      // Belt and suspenders: js/product-focus.js has its own, separate
      // boundary for "have we left the strip" (card-geometry-based, since it
      // has no notion of the hero at all), which should agree with this one
      // but — observed on phones, where the narrow-screen CSS scales the
      // whole lens system by a different factor than the hero's own layout —
      // can occasionally disagree by a frame or two, leaving the label/viewer
      // shown a beat into the hero. This measurement is the simpler and more
      // direct one for "are we clear of the hero", so on the transition back
      // into it, it forces the label/viewer closed regardless of what focus
      // state product-focus.js currently thinks it's in.
      //
      // The actual closing (glassEntered/viewerHost) happens right here,
      // not inside leaveGrid() itself: that function is shared with
      // EmjiveFocus's very first, synchronous "nothing focused yet" ping,
      // fired the instant the wiring section subscribes below — before the
      // grid has rendered a single card. Resetting glassEntered there would
      // spuriously undo an "already past the boundary" state a restored
      // scroll position can set up moments earlier in this very same
      // synchronous script run.
      leaveGrid();
      glassEntered = false;
      glassRevealReady = false;
      if (viewerHost) viewerHost.classList.remove("is-visible");
      playGlass(1, Math.abs(glassFrame - 1) * GLASS_NATIVE_FRAME_MS);
    }
    glassWasPast = past;

    if (past) layoutLens();
  }

  function requestGlassSync() {
    if (glassTicking) return;
    glassTicking = true;
    requestAnimationFrame(syncGlass);
  }

  window.addEventListener("scroll", requestGlassSync, { passive: true });
  window.addEventListener("resize", requestGlassSync);
  // The hero arrives at runtime and changes the slot's height when it does,
  // so the first correct measurement can only happen after that.
  if (window.EmjiveSeries && window.EmjiveSeries.ready) {
    window.EmjiveSeries.ready.then(requestGlassSync, requestGlassSync);
  }
  syncGlass();

  /* ---- the magnified view + label ---------------------------------------- */

  if (!viewerHost || !magHost || !labelEl || !window.EmjiveFocus) return;

  // Read from CSS rather than duplicated here: --lens-mag also sizes the
  // stills' boxes and the live viewer's box, and the three only agree —
  // which is the whole basis of the invisible handoff — if they're one
  // number.
  var MAGNIFICATION = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--lens-mag")
  ) || 1.25;
  // The label's two phases, which must match the durations css/style.css
  // gives .lens-label's transform and .lens-label__text's opacity.
  var LABEL_TEXT_MS = 150;
  var LABEL_BAR_MS = 350;
  // How long a departing model gets to ease back to its default pose —
  // after which it is indistinguishable from its still and can be handed
  // over silently. It has to arrive there well before it leaves the glass
  // (measured at ~600ms into an 850ms scroll), because from the moment the
  // product starts moving, part of its plain un-magnified icon is emerging
  // from behind the disc — and that icon is always the default pose.
  // Anything slower and the two disagree in plain sight; anything much
  // faster reads as a snap rather than a continuation of the motion.
  var DEPART_RESET_MS = 450;
  var DRAG_THRESHOLD = 6;

  var magItems = [];      // [{ img, figure, product }] — one per visible product
  var viewer = null;      // the page's one and only viewer handle
  var owner = null;       // the entry the viewer is currently drawn at
  var shown = false;      // is the viewer visible (and so covering its still)
  var viewerHref = "#";   // where a click on the live model navigates
  var pending = null;     // product waiting to be loaded once the strip stops
  var loadToken = 0;      // guards against a stale load resolving late
  var departTimer = null;
  var labelTimer = null;
  var labelWaiting = null; // a focused product whose label is queued behind
                            // the glass finishing its extend — see
                            // revealMagnifiedContent() and the onChange
                            // handler below

  /* ---- geometry ----------------------------------------------------------- */

  // The lens mapping, in one line: a point at viewport offset d from the
  // screen's centre appears at MAGNIFICATION * d from the glass's centre.
  // Applied to a real, measured icon box, in the glass's own coordinates.
  function magnifiedBox(figure, disc) {
    var box = figure.getBoundingClientRect();
    var w = box.width * MAGNIFICATION;
    var h = box.height * MAGNIFICATION;
    var x = disc / 2 + (box.left + box.width / 2 - window.innerWidth / 2) * MAGNIFICATION;
    var y = disc / 2 + (box.top + box.height / 2 - window.innerHeight / 2) * MAGNIFICATION;
    return { w: w, h: h, left: x - w / 2, top: y - h / 2, centre: y };
  }

  function place(el, b) {
    var s = el.style;
    s.width = b.w + "px";
    s.height = b.h + "px";
    s.left = b.left + "px";
    s.top = b.top + "px";
  }

  // Runs on every scroll frame (via syncGlass) — this is what makes the
  // glass magnify continuously as products travel through it, rather than
  // only once one has settled.
  function layoutLens() {
    var disc = viewerHost.offsetWidth;
    if (!disc) return;

    for (var i = 0; i < magItems.length; i++) {
      var item = magItems[i];
      var b = magnifiedBox(item.figure, disc);
      // Nowhere near the glass — skip the style writes rather than laying
      // out every product of a long series on every frame.
      if (b.centre + b.h / 2 < 0 || b.centre - b.h / 2 > disc) {
        if (item.img.style.display !== "none") item.img.style.display = "none";
        continue;
      }
      item.img.style.display = "";
      place(item.img, b);
    }

    // Drawn at its product's position, not the glass's — see rule 1 above.
    if (viewer && owner) place(viewer.el, magnifiedBox(owner.figure, disc));

    syncStills();
  }

  // A still is hidden only while the live viewer is actually covering it —
  // otherwise the product would be drawn twice, once rendered and once as
  // its capture.
  function syncStills() {
    for (var i = 0; i < magItems.length; i++) magItems[i].img.style.visibility = "";
    if (shown && owner) owner.img.style.visibility = "hidden";
  }

  /* ---- the stack ---------------------------------------------------------- */

  function buildMagnifiedStack() {
    // The entries these referenced are gone; the viewer itself survives.
    hideViewer();
    owner = null;
    pending = null;
    loadToken++;

    magItems = [];
    magHost.innerHTML = "";
    var entries = window.EmjiveFocus.entries();
    for (var i = 0; i < entries.length; i++) {
      var figure = entries[i].el.querySelector(".product-card__figure");
      var source = figure && figure.querySelector("img");
      if (!source) continue;
      var img = document.createElement("img");
      // The card's own already-loaded src, so the duplicate stack costs no
      // extra requests.
      img.src = source.src;
      img.alt = "";
      magHost.appendChild(img);
      magItems.push({ img: img, figure: figure, product: entries[i].product });
    }
    layoutLens();
  }

  function itemFor(product) {
    for (var i = 0; i < magItems.length; i++) {
      if (magItems[i].product === product) return magItems[i];
    }
    return null;
  }

  /* ---- the viewer --------------------------------------------------------- */

  function showViewer() {
    if (!viewer || !owner) return;
    shown = true;
    viewer.el.style.visibility = "visible";
    viewer.el.style.pointerEvents = "auto";
    layoutLens();
  }

  function hideViewer() {
    shown = false;
    if (viewer) {
      viewer.el.style.visibility = "hidden";
      viewer.el.style.pointerEvents = "none";
    }
    syncStills();
  }

  // A real click (near-zero pointer movement between down and up) opens the
  // product; a drag past DRAG_THRESHOLD is left alone, since that's
  // TrackballControls rotating the model. Distance-based rather than a plain
  // "click" listener because a click still fires at the end of a rotate-drag
  // as long as the pointer lifts over the same element, which would
  // otherwise navigate away every time someone just wanted to spin the
  // model. Reads viewerHref live rather than closing over one product —
  // the viewer outlives every product it shows.
  function wireModelClickNavigation(el) {
    var startX = 0;
    var startY = 0;
    el.addEventListener("pointerdown", function (e) {
      startX = e.clientX;
      startY = e.clientY;
    });
    el.addEventListener("pointerup", function (e) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) window.location.href = viewerHref;
    });
  }

  // Deliberately called only once the strip has stopped. The still on screen
  // is identical to what the live render will be, so there is nothing to
  // gain by racing — and everything to lose, since a glTF load is the one
  // remaining piece of blocking work and running it mid-scroll is what put a
  // dropped frame in the middle of the animation.
  function loadPending() {
    var product = pending;
    if (!product) return;
    var entry = itemFor(product);
    if (!entry) return;
    if (!product.assets || !product.assets.model || !window.EmjiveModelViewer) return;
    pending = null;

    var token = ++loadToken;
    viewerHref = window.EmjiveSeries
      ? window.EmjiveSeries.productHref(product, window.EmjiveSeries.slug)
      : "#";

    if (viewer) {
      owner = entry;
      layoutLens(); // position it, still hidden, before it paints
      viewer.loadProduct(product, product["default-metal"]).then(function (ok) {
        if (!ok || token !== loadToken) return;
        showViewer();
      }, function () { /* load failed — the still simply stays */ });
      return;
    }

    // First product of the session: the only time a renderer, a WebGL
    // context and a PMREM'd environment map get built. Every later product
    // reuses all three through loadProduct() above.
    var built = window.EmjiveModelViewer(product, product["default-metal"], {
      hdri: window.EmjiveSeries && window.EmjiveSeries.hdriPath(window.EmjiveSeries.slug),
      onReady: function () {
        if (token !== loadToken) return;
        // No setCameraOrbit(): the product's own default orbit is exactly
        // the pose fallback-img was captured at, and the magnification comes
        // from rendering that pose into a larger box (see the CSS).
        // Overriding the camera here is what would break the match.
        showViewer();
      }
    });
    // Returns null rather than throwing when the browser won't grant a
    // context; the stills simply stay, for every product.
    if (!built) return;

    viewer = built;
    owner = entry;
    viewer.el.style.visibility = "hidden";
    viewer.el.style.pointerEvents = "none";
    viewerHost.appendChild(viewer.el);
    wireModelClickNavigation(viewer.el);
    layoutLens();
  }

  /* ---- the label ---------------------------------------------------------- */

  function setLabelContent(product) {
    labelEl.href = window.EmjiveSeries
      ? window.EmjiveSeries.productHref(product, window.EmjiveSeries.slug)
      : "#";
    labelName.textContent = product.name || "";
    labelType.textContent = product.category ? "." + product.category.toLowerCase() : "";
  }

  // Phase 1 of a change: drop the text, then send the bar off the right of
  // the screen, then hand over to `then` (if there's a next product). Runs as
  // one timer chain rather than CSS transition-delays so a fast scroll
  // through several products can cancel it cleanly at any point.
  function retractLabel(then) {
    if (labelTimer) clearTimeout(labelTimer);

    // Already parked off-screen — nothing to retract, so don't make the
    // first product of the session wait out an animation that isn't running.
    if (!labelEl.classList.contains("is-in")) {
      if (then) then();
      return;
    }

    labelEl.classList.remove("is-labelled");
    labelTimer = setTimeout(function () {
      labelEl.classList.remove("is-in");
      labelTimer = then ? setTimeout(then, LABEL_BAR_MS) : null;
    }, LABEL_TEXT_MS);
  }

  // Phase 2: content is set while the bar is still off-screen, so nothing is
  // ever seen changing in place; then the bar slides back in and only
  // afterwards does the text fade up on it.
  function presentLabel(product) {
    setLabelContent(product);
    labelEl.classList.add("is-in");
    if (labelTimer) clearTimeout(labelTimer);
    labelTimer = setTimeout(function () {
      labelEl.classList.add("is-labelled");
    }, LABEL_BAR_MS);
  }

  /* ---- wiring ------------------------------------------------------------- */

  // Shared by the two ways "no product is focused any more" can happen:
  // js/product-focus.js resolving there itself (its own boundary, normally
  // in agreement with the glass's), and syncGlass()'s belt-and-suspenders
  // override above (the glass's own boundary, taken as authoritative when
  // the two disagree). Same departure treatment either way — the outgoing
  // model eases home rather than being cut, per the rule at the top of this
  // file — this just skips straight to it without a next product queued.
  // Note: this does NOT touch glassEntered/glassRevealReady/viewerHost's
  // is-visible — that's syncGlass()'s own reverse-crossing branch's job (see
  // its comment). This function also runs on EmjiveFocus's very first,
  // synchronous "nothing focused yet" ping at subscribe time, before the
  // grid has rendered a single card — touching that glass-side state here
  // would fire on every page load, not just a real departure.
  function leaveGrid() {
    labelWaiting = null;
    if (departTimer) clearTimeout(departTimer);
    if (shown && viewer) {
      if (viewer.returnToDefaultPose) viewer.returnToDefaultPose(DEPART_RESET_MS);
      departTimer = setTimeout(hideViewer, DEPART_RESET_MS);
    }
    pending = null;
    retractLabel();
  }

  // The entrance's counterpart to leaveGrid(): called once playGlass()
  // reaches the glass's last frame, never in sync with the crossing itself
  // — a product's name (and the magnified viewer) must never be seen
  // floating inside a half-formed glass shape. Reveals the viewer container
  // immediately and, if a product got focused while the glass was still
  // extending, presents its label now instead of at focus time.
  function revealMagnifiedContent() {
    glassRevealReady = true;
    if (viewerHost) viewerHost.classList.add("is-visible");
    layoutLens();
    if (labelWaiting) {
      var product = labelWaiting;
      labelWaiting = null;
      retractLabel(function () { presentLabel(product); });
    }
  }

  window.EmjiveFocus.onChange(function (product) {
    // The real entrance trigger (see enterGrid()'s own comment): this fires
    // in the exact synchronous call js/product-focus.js's goTo() starts its
    // snap-to-first-item tween in — "Focus changes up front, not on
    // arrival" is that file's own words for it — so the glass starts
    // extending in the same frame the strip starts moving. Guarded by
    // glassEntered, not by "is this the first product ever": EmjiveFocus
    // calls this synchronously with its current value the instant it's
    // subscribed to, below, which — before the grid has rendered a single
    // card — is always null, and there's nothing to guard there anyway.
    if (product && !glassEntered) enterGrid();

    if (!product) {
      leaveGrid();
      return;
    }

    if (departTimer) clearTimeout(departTimer);
    if (shown && viewer) {
      // Send the outgoing model home. It stays visible and rendering the
      // whole way — travelling out of the glass with its product, spinning
      // down into its default pose — and is only handed back to its still
      // once it gets there, at which point the two are identical and the
      // handover cannot be seen. Hiding it any earlier is the abrupt stop
      // this whole arrangement exists to avoid.
      if (viewer.returnToDefaultPose) viewer.returnToDefaultPose(DEPART_RESET_MS);
      departTimer = setTimeout(hideViewer, DEPART_RESET_MS);
    }

    pending = product;
    if (glassRevealReady) {
      labelWaiting = null;
      retractLabel(function () { presentLabel(product); });
    } else {
      // The glass hasn't finished extending yet — revealMagnifiedContent()
      // presents this once it does, rather than showing it now.
      labelWaiting = product;
    }
  });

  window.EmjiveFocus.onSettled(function () {
    loadPending();
  });

  // js/product-focus.js listens for this too, and — being loaded first (see
  // index.html) — has already refreshed its own entries by the time this
  // runs, so EmjiveFocus.entries() is current here.
  window.addEventListener("emjive:grid-changed", buildMagnifiedStack);
  // And the warm-cache case product-focus.js guards against: if the grid
  // rendered before these scripts ran, the event is already gone, but its
  // entries are there to be read.
  buildMagnifiedStack();
})();
