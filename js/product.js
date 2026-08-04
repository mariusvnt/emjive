/* ==========================================================================
   J&MV — product detail page
   Resolves ?id= against data/products.json and renders the label, carousel,
   metal picker, description, characteristics and size/selection flow.
   ========================================================================== */

(function () {
  "use strict";

  var root = document.getElementById("productDetail");
  if (!root) return;

  var loadingEl = document.getElementById("productDetailLoading");
  var contentEl = document.getElementById("productDetailContent");

  var state = {
    product: null,
    metals: [],
    sizesByCategory: {},
    sizeUnits: {},
    selectedMetal: null,
    selectedSize: null,
    slideCount: 0,
    scrollOffset: 0,
    modelHandle: null,
    iconFallbackImg: null
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function getIdFromQuery() {
    return new URLSearchParams(window.location.search).get("id");
  }

  function showNotFound() {
    loadingEl.textContent = "Product not found — ";
    var link = el("a", "btn", "Browse the collection");
    // Back to whichever series was being browsed, not always the featured
    // one — mainHref() drops the ?series= for the featured slug anyway.
    var slug = state.seriesSlug || (window.EmjiveSeries && window.EmjiveSeries.slug);
    link.href = (slug ? window.EmjiveSeries.mainHref(slug) : "index.html") + "#products";
    loadingEl.appendChild(link);
  }

  // Product ids are only unique WITHIN a series now, so a bare ?id= (an old
  // bookmark, or a link built before this refactor) can't identify a product
  // on its own. Resolution order: the active series first — which is the
  // featured one unless ?series= says otherwise — then every other series in
  // index order. The scan costs nothing in the normal case, since step 1
  // hits, and it's bounded by the number of series. If two series ever share
  // an id and the URL carries no ?series=, the active one wins, which is the
  // friendliest resolution available.
  function findProduct(slug, id) {
    return window.EmjiveSeries.loadProducts(slug).then(function (products) {
      var product = products.find(function (p) { return p.id === id; });
      if (product) return { product: product, slug: slug };

      var others = window.EmjiveSeries.all()
        .map(function (s) { return s.slug; })
        .filter(function (s) { return s !== slug; });

      return others.reduce(function (chain, otherSlug) {
        return chain.then(function (found) {
          if (found) return found;
          return window.EmjiveSeries.loadProducts(otherSlug).then(function (list) {
            var hit = list.find(function (p) { return p.id === id; });
            return hit ? { product: hit, slug: otherSlug } : null;
          });
        });
      }, Promise.resolve(null));
    });
  }

  function init() {
    window.EmjiveSeries.ready
      .then(function (ctx) {
        state.metals = ctx.index.metals || [];
        return findProduct(ctx.slug, getIdFromQuery());
      })
      .then(function (found) {
        if (!found) return showNotFound();
        state.product = found.product;
        state.seriesSlug = found.slug;
        render(found.product);
      })
      .catch(function () {
        showNotFound();
      });
  }

  function render(product) {
    document.title = (product.name || "Product") + " — em·ji·ve";
    state.selectedMetal = product.metal || state.metals[0] || "steel";

    renderLabel(product);
    renderCarousel(product);
    renderMetalOptions(product);
    renderSpecs(product);
    document.getElementById("productDescription").textContent =
      product.description || "No description yet.";
    wireSelectButton(product);

    loadingEl.hidden = true;
    contentEl.hidden = false;

    // Carousel geometry (computeBounds' getBoundingClientRect calls) can
    // only be measured once #productDetailContent is actually visible —
    // while it's [hidden], every element in it has a zero-size box, which
    // would make computeBounds see a zero-width tile/carousel and rest at
    // offset 0 instead of centering the first tile.
    syncCarouselBounds(true);
  }

  /* ---- 1. label ------------------------------------------------------- */

  function renderLabel(product) {
    document.getElementById("productLabelName").textContent = product.name || "";
    document.getElementById("productLabelType").textContent =
      product.category ? "." + product.category.toLowerCase() : "";

    renderLabelThumb(product);
    renderLabelPrice(product);
  }

  // Always the icon (not a photos[0] fallback) — this thumbnail sits right
  // next to the name at a fixed small size, so it needs the icon's
  // consistent transparent-background framing rather than a real photo's
  // arbitrary crop. No thumbnail at all if there's no icon for the
  // currently selected metal, rather than showing a broken or placeholder
  // image. Re-run from onMetalSelect too (not just the initial render), so
  // the thumbnail always matches whichever finish is currently selected.
  function renderLabelThumb(product) {
    var thumb = document.getElementById("productLabelThumb");
    var thumbSrc = (product.icons && product.icons[state.selectedMetal]) || "";
    if (thumbSrc) {
      thumb.src = thumbSrc;
      thumb.hidden = false;
    } else {
      thumb.hidden = true;
    }
  }

  function renderLabelPrice(product) {
    var details = (product.metalDetails && product.metalDetails[state.selectedMetal]) || {};
    document.getElementById("productLabelPrice").textContent =
      window.EmjiveSelection.formatPrice(details.price || 0);
  }

  /* ---- 2. carousel ------------------------------------------------------ */

  function renderCarousel(product) {
    var track = document.getElementById("productCarouselTrack");
    // .product-carousel--single lives on the outer frame, not
    // #productCarousel itself — see css/style.css's .product-carousel-frame
    // comment for why --tile (which that class's override also targets)
    // had to move up there.
    var carouselFrame = document.getElementById("productCarouselFrame");
    track.innerHTML = "";

    // Static backdrop behind the filmstrip, independent of the metal
    // picker/slides — no product.assets.xray yet (Foramen/Disc today)
    // means no backdrop at all, rather than a broken image.
    var xray = document.getElementById("productCarouselXray");
    var xraySrc = product.assets && product.assets.xray;
    if (xraySrc) {
      xray.src = xraySrc;
      xray.hidden = false;
    } else {
      xray.hidden = true;
    }

    var slideSources = [];
    // window.EmjiveModelViewer is exposed by js/three-viewer.js — reused
    // here so the viewer construction/material logic lives in exactly one
    // place. It can return null if the browser couldn't grant a WebGL
    // context (see its own comment) — falls through to the same icon
    // fallback branch a product with no "model" field at all uses, rather
    // than leaving the carousel empty.
    state.modelHandle = product.model ? window.EmjiveModelViewer(product, state.selectedMetal) : null;
    if (state.modelHandle) {
      // Smaller than the photo slides on purpose — leaves generous empty
      // space around the model to drag/swipe the carousel from without
      // that drag landing on the viewer's own TrackballControls instead.
      var modelSlide = el("div", "product-carousel__slide product-carousel__slide--model");
      modelSlide.appendChild(state.modelHandle.el);
      track.appendChild(modelSlide);
      slideSources.push("model");
    } else {
      var fallbackIconSrc = product.icons && product.icons[state.selectedMetal];
      if (fallbackIconSrc) {
        var iconSlide = buildImageSlide(fallbackIconSrc, product.name);
        // Kept so onMetalSelect can swap its src on a metal switch — this
        // slide isn't rebuilt then, only the 3D viewer path re-tints live,
        // so a static image needs its own explicit update.
        state.iconFallbackImg = iconSlide.querySelector("img");
        track.appendChild(iconSlide);
        slideSources.push("icon");
      }
    }

    (product.photos || []).forEach(function (src) {
      track.appendChild(buildImageSlide(src, product.name));
      slideSources.push(src);
    });

    state.slideCount = slideSources.length;
    carouselFrame.classList.toggle("product-carousel--single", state.slideCount <= 1);
    // Bounds aren't synced here — #productDetailContent is still [hidden]
    // at this point (render() calls this before unhiding it), so every
    // element would measure as zero-size. render() does the initial
    // syncCarouselBounds(true) itself, right after unhiding.
  }

  function buildImageSlide(src, alt) {
    var slide = el("div", "product-carousel__slide");
    var img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    img.loading = "lazy";
    // Otherwise dragging a photo on desktop kicks off the browser's native
    // image-drag-and-drop gesture instead of (or fighting with) our own
    // custom pointer-drag scrolling — see the dragstart guard in
    // wireCarouselNav for the rest of this fix.
    img.draggable = false;
    slide.appendChild(img);
    return slide;
  }

  function measureTileWidth() {
    var track = document.getElementById("productCarouselTrack");
    var first = track.firstElementChild;
    return first ? first.getBoundingClientRect().width : 0;
  }

  // Bounds are expressed as "the first/last tile centered in the
  // carousel", not "flush to an edge" or "hug to fit" — offset decreases
  // as later tiles get centered, so max (least scrolled) centers the
  // first tile and min (most scrolled) centers the last one. This holds
  // even when the whole filmstrip would technically fit within the
  // available width (max > min: still a real, non-zero scroll range) —
  // the carousel always rests on the first tile centered and stays
  // scrollable through the rest, rather than collapsing to a static
  // "show everything" layout once there's enough room.
  function computeBounds() {
    var carousel = document.getElementById("productCarousel");
    var availableWidth = carousel.getBoundingClientRect().width;
    var tile = measureTileWidth();
    var max = (availableWidth - tile) / 2;
    var min = max - (state.slideCount - 1) * tile;
    return { min: min, max: max, width: availableWidth };
  }

  // transition, when given, overrides the default snap — see
  // CENTER_TRANSITION below, the sole caller that does.
  function applyOffset(offsetPx, animate, transition) {
    var track = document.getElementById("productCarouselTrack");
    track.style.transition = animate ? (transition || "transform 0.25s cubic-bezier(0.4, 0, 0.6, 1)") : "none";
    track.style.transform = "translateX(" + offsetPx + "px)";
    state.scrollOffset = offsetPx;
  }

  // Shared by every way a slide gets centered — tapping it directly, or a
  // phone-style paging drag settling onto it (see wireCarouselNav) — so
  // both read as the same gesture language rather than two different
  // animation feels. Same perfectly symmetric ease-in-out curve as
  // applyOffset's own default above (control points mirrored around the
  // curve's own center: (0.4, 0) and its point-reflection (0.6, 1)) — a
  // real zero-velocity start easing into an equally gentle, symmetric
  // stop, rather than a front-loaded curve that reads as an abrupt jump
  // once it's covering a full tile's width.
  var CENTER_TRANSITION = "transform 0.25s cubic-bezier(0.4, 0, 0.6, 1)";
  // Same symmetric curve, shorter — used only when a phone drag cancels
  // a slide change (doesn't commit, so it settles back on the slide it
  // started on) rather than actually landing on a different one; see
  // settleDrag in wireCarouselNav.
  var CANCEL_TRANSITION = "transform 0.2s cubic-bezier(0.4, 0, 0.6, 1)";

  // reset (true right after a product's slides are (re)built) snaps to the
  // starting position (first tile centered). Otherwise (on resize) the
  // current position is re-clamped into the new bounds instead — resizing
  // changes tile size (and thus the scroll range) without any product
  // re-render.
  function syncCarouselBounds(reset) {
    if (state.slideCount === 0) return;
    var bounds = computeBounds();
    var target = reset ? bounds.max : Math.max(bounds.min, Math.min(bounds.max, state.scrollOffset));
    applyOffset(target, false);
  }

  // Centers a given slide — either a direct tap on it, or where a phone's
  // paging drag settles (see wireCarouselNav) — jumping straight there
  // however far from center it started, not a step-by-one-tile page.
  // index 0 centers the first tile (offset bounds.max), the last index
  // centers the last tile (bounds.min), same mapping computeBounds' own
  // comment describes. CENTER_TRANSITION by default, so every way a
  // slide gets centered moves identically — transition overrides that
  // (see CANCEL_TRANSITION's use in settleDrag, the sole caller that
  // does).
  function centerOnSlide(index, transition) {
    if (state.slideCount <= 1) return;
    var bounds = computeBounds();
    var tile = measureTileWidth();
    var target = Math.max(bounds.min, Math.min(bounds.max, bounds.max - index * tile));
    applyOffset(target, true, transition || CENTER_TRANSITION);
  }

  // WebKit-style rubber-band damping for drag-past-the-bounds overshoot,
  // at either end — the further past a bound you drag, the harder it gets
  // to pull further, rather than tracking the pointer 1:1.
  function rubberBand(overshoot, dimension) {
    var c = 0.55;
    return (overshoot * dimension * c) / (dimension + c * overshoot);
  }

  // Same breakpoint css/style.css's .product-grid rule uses for its own
  // phone-vs-wide-screen switch — the only responsive threshold anywhere
  // on the site, reused here rather than inventing a second one.
  function isMobileCarousel() {
    return window.matchMedia("(max-width: 640px)").matches;
  }

  // No visible arrows: navigation is either a tap on a slide, which jumps
  // straight to centering that slide — however far from center it
  // started, not a step-by-one-tile page — or a real drag. A real drag's
  // release behaves differently by screen size: on a wide screen it lands
  // exactly wherever the drag left it, free, clamped back into bounds; on
  // a phone (see isMobileCarousel above) it always pages exactly one
  // slide forward/backward in the drag's direction and centers it, since
  // free positioning there mostly just leaves the filmstrip resting
  // between two slides. Wired once here, since the viewport/track
  // elements are static markup in product.html — only the slides inside
  // the track change per product.
  function wireCarouselNav() {
    var viewport = document.querySelector(".product-carousel__viewport");
    var track = document.getElementById("productCarouselTrack");

    // Otherwise a mouse drag starting on a photo kicks off the browser's
    // own native image-drag-and-drop gesture (desktop only — touch drags
    // don't trigger it), which fights with the custom pointer-drag scroll
    // below. img.draggable = false (set in buildImageSlide) covers real
    // <img> slides; this covers anything else a browser might still try
    // to drag (e.g. the 3D viewer's poster image while it's loading).
    viewport.addEventListener("dragstart", function (e) { e.preventDefault(); });

    var dragging = false;
    var dragStartX = 0;
    var dragStartY = 0;
    var dragStartOffset = 0;
    var dragBounds = null;
    // The slide the pointer actually landed on at dragStart (from that
    // event's own target, before pointer capture below starts pinning
    // every subsequent event's target to the viewport) — used by endDrag
    // to know which slide to center on a tap.
    var dragStartSlide = null;
    // Below this much pointer movement, a release counts as a tap (center
    // whichever slide it started on) rather than a drag — same threshold
    // js/main.js's wireModelClickNavigation uses for the equivalent
    // click-vs-drag problem on the 3D models. Doubles as the axis-lock
    // slop below, so there's a single "did this actually move" threshold
    // rather than two competing ones.
    var TAP_THRESHOLD = 6;
    // Which pointer (if any) is currently being tracked from pointerdown
    // through its eventual pointerup/cancel — including the ambiguous
    // window right after pointerdown, before axisLocked below is decided.
    var trackedPointerId = null;
    // Set the moment a tracked pointer's movement first exceeds
    // TAP_THRESHOLD on either axis: true if it turned out horizontal
    // (dragging becomes true, the carousel takes over), false if vertical
    // (handed off untouched to the browser's own touch-action: pan-y
    // scroll — see .product-carousel__viewport). Stays null while still
    // ambiguous, so a real tap (which never crosses the slop at all)
    // never has to pick an axis.
    var axisLocked = null;
    // Recent drag speed (px/ms), exponentially smoothed frame to frame so
    // a single jittery pointermove right before release doesn't dominate
    // it — used to give the release a small momentum coast in endDrag.
    var dragLastX = 0;
    var dragLastT = 0;
    var dragVelocity = 0;

    function onPointerDown(e) {
      // A drag that starts on the 3D model slide should rotate the model
      // (the viewer's own TrackballControls, js/three-viewer.js), not page
      // the carousel.
      if (state.slideCount <= 1 || e.target.closest(".emjive-3d-viewer")) return;
      dragBounds = computeBounds();
      trackedPointerId = e.pointerId;
      axisLocked = null;
      dragStartSlide = e.target.closest(".product-carousel__slide");
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartOffset = state.scrollOffset;
      dragLastX = e.clientX;
      dragLastT = e.timeStamp;
      dragVelocity = 0;
      // Deliberately no setPointerCapture/dragging=true/applyOffset here
      // yet — which axis this gesture is on isn't known until it clears
      // TAP_THRESHOLD in onPointerMove below. Committing to the carousel
      // this early used to mean a touch that turned out to be a vertical
      // scroll still nudged the filmstrip sideways on its natural
      // diagonal wobble before the browser recognized the scroll,
      // fighting the page's own touch-action: pan-y the whole time.
    }

    function onPointerMove(e) {
      if (e.pointerId !== trackedPointerId) return;
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;

      if (axisLocked === null) {
        if (Math.abs(dx) < TAP_THRESHOLD && Math.abs(dy) < TAP_THRESHOLD) return; // still ambiguous
        axisLocked = Math.abs(dx) > Math.abs(dy);
        if (!axisLocked) {
          // Vertical — hand off to the browser's native pan-y scroll and
          // stop tracking this pointer entirely; nothing here has
          // touched the carousel yet, so there's nothing to undo.
          trackedPointerId = null;
          return;
        }
        dragging = true;
        applyOffset(state.scrollOffset, false); // kill any in-flight transition
        viewport.setPointerCapture(e.pointerId);
      }
      if (!dragging) return;

      var raw = dragStartOffset + dx;
      var next;
      if (raw > dragBounds.max) {
        var startOvershoot = raw - dragBounds.max;
        next = dragBounds.max + rubberBand(startOvershoot, dragBounds.width);
      } else if (raw < dragBounds.min) {
        var endOvershoot = dragBounds.min - raw;
        next = dragBounds.min - rubberBand(endOvershoot, dragBounds.width);
      } else {
        next = raw;
      }
      applyOffset(next, false);

      var dt = e.timeStamp - dragLastT;
      if (dt > 0) {
        var instantVelocity = (e.clientX - dragLastX) / dt;
        dragVelocity = dragVelocity * 0.7 + instantVelocity * 0.3;
      }
      dragLastX = e.clientX;
      dragLastT = e.timeStamp;
    }

    function endDrag(e) {
      if (e.pointerId !== trackedPointerId) return;
      trackedPointerId = null;
      var wasDragging = dragging;
      dragging = false;
      if (!wasDragging) {
        // Never crossed the axis-lock slop in onPointerMove — a tap, not
        // a drag. (If it turned out vertical instead, onPointerMove
        // already cleared trackedPointerId itself and this function
        // returned above before ever reaching here — nothing to do,
        // since the carousel never touched the track for that gesture.)
        // Any sub-threshold jitter was never applied in the first place
        // (onPointerMove returns early until the slop is cleared), so
        // there's nothing to snap back from — just center whichever
        // slide it landed on.
        if (dragStartSlide) centerOnSlide(Array.prototype.indexOf.call(track.children, dragStartSlide));
        return;
      }
      settleDrag(e);
    }

    // A pointercancel means the browser interrupted this pointer's normal
    // processing itself — most commonly a vertical scroll on a phone:
    // touch-action: pan-y lets the browser take that over natively, and
    // it can send the cancel before our own onPointerMove ever sees
    // enough movement to axis-lock (a fast vertical swipe is recognized
    // and handed to native scrolling almost immediately). That used to
    // reach endDrag with dragging still false, which read as "a tap" and
    // centered whatever slide the touch started on — including jumping
    // to it from wherever the strip currently was, if that slide wasn't
    // the one already centered. A cancel should never be read as a tap:
    // it's specifically the "this wasn't a deliberate pointer gesture on
    // this element" signal, so an unresolved one is a pure no-op here.
    function onPointerCancel(e) {
      if (e.pointerId !== trackedPointerId) return;
      trackedPointerId = null;
      var wasDragging = dragging;
      dragging = false;
      if (!wasDragging) return;
      // Did commit to a horizontal drag before being interrupted — settle
      // it same as a real release, except by the strip's own current
      // (already live-updated) position rather than this event's
      // coordinates, which a cancel doesn't reliably carry.
      settleDrag(null);
    }

    // Shared release-settling for a real horizontal drag, whether it
    // ended in a clean pointerup (e is that event, used for the mobile
    // page's direction/distance) or was interrupted mid-drag (e is null —
    // see onPointerCancel above, which settles by position instead).
    function settleDrag(e) {
      if (isMobileCarousel()) {
        var tile = measureTileWidth();
        var startIndex = Math.round((dragBounds.max - dragStartOffset) / tile);
        var direction = 0;
        if (e) {
          // A real drag on a phone always resolves to exactly one slide
          // step, centered — never free-floating between two slides the
          // way a wide-screen drag can. Commits to the next/previous
          // slide (whichever direction it was dragged) only past a real
          // distance or a fast-enough flick; short/slow drags spring
          // back to the slide they started on, same as a cancelled swipe
          // would.
          var dx = e.clientX - dragStartX;
          var absDx = Math.abs(dx);
          var COMMIT_FRACTION = 0.15; // of a tile's width
          // A short drag can still smooth out to a spuriously high
          // velocity from raw touch-event jitter (coalesced touchmove
          // samples a few sub-16ms apart) — MIN_FLICK_DISTANCE stops
          // that noise from reading as a deliberate flick on what's
          // really just a tiny, unsteady scroll, which was paging a full
          // slide on barely any movement.
          var MIN_FLICK_DISTANCE = 18; // px
          var FLICK_VELOCITY = 0.6; // px/ms
          var committed = absDx > tile * COMMIT_FRACTION || (absDx > MIN_FLICK_DISTANCE && Math.abs(dragVelocity) > FLICK_VELOCITY);
          direction = committed ? (dx < 0 ? 1 : -1) : 0;
        }
        // No event to read a direction from (an interruption) — nearest
        // slide by the strip's own current position instead.
        var index = e ? startIndex + direction : Math.round((dragBounds.max - state.scrollOffset) / tile);
        index = Math.max(0, Math.min(state.slideCount - 1, index));
        // Landing back on the same slide it started on means the drag
        // cancelled the slide change rather than committing to one —
        // shorter transition for that spring-back than an actual change
        // to a different slide gets.
        centerOnSlide(index, index === startIndex ? CANCEL_TRANSITION : undefined);
      } else {
        // Free positioning: lands exactly where the drag left it, no
        // momentum coast — just clamped back into bounds, which also
        // springs it back if it was rubber-banded past either end.
        var target = Math.max(dragBounds.min, Math.min(dragBounds.max, state.scrollOffset));
        applyOffset(target, true);
      }
    }

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", onPointerCancel);

    var resizeTicking = false;
    window.addEventListener("resize", function () {
      if (resizeTicking) return;
      resizeTicking = true;
      requestAnimationFrame(function () {
        resizeTicking = false;
        syncCarouselBounds(false);
      });
    });
  }

  /* ---- 3. metal selection ------------------------------------------------ */

  function renderMetalOptions(product) {
    var wrap = document.getElementById("productMetalOptions");
    wrap.innerHTML = "";
    state.metals.forEach(function (metal) {
      var optionWrap = el("div", "product-metals__option-wrap");
      optionWrap.classList.toggle("is-selected", metal === state.selectedMetal);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "product-metals__option";
      btn.dataset.metal = metal;
      btn.setAttribute("aria-label", metal);
      btn.addEventListener("click", function () { onMetalSelect(product, metal); });

      optionWrap.appendChild(btn);
      optionWrap.appendChild(el("span", "product-metals__option-label", metal));
      wrap.appendChild(optionWrap);
    });
  }

  function onMetalSelect(product, metal) {
    if (metal === state.selectedMetal) return;
    state.selectedMetal = metal;
    document.querySelectorAll(".product-metals__option-wrap").forEach(function (optionWrap) {
      var btn = optionWrap.querySelector(".product-metals__option");
      optionWrap.classList.toggle("is-selected", btn.dataset.metal === metal);
    });
    // Re-tints the existing model in place (no reload, no camera reset).
    if (state.modelHandle) state.modelHandle.applyMetal(metal);
    // The model re-tints itself live above, but the label thumbnail (and,
    // for model-less products, the carousel's fallback slide) are static
    // images — each needs its own explicit swap to the new metal's icon.
    renderLabelThumb(product);
    if (state.iconFallbackImg) {
      state.iconFallbackImg.src = (product.icons && product.icons[metal]) || "";
    }
    renderSpecs(product);
    renderLabelPrice(product);
  }

  /* ---- 6. characteristics (metal-dependent) ------------------------------ */

  function renderSpecs(product) {
    var details = (product.metalDetails && product.metalDetails[state.selectedMetal]) || {};
    var dl = document.getElementById("productSpecs");
    dl.innerHTML = "";
    appendSpecRow(dl, "Metal", capitalize(state.selectedMetal));
    appendSpecRow(dl, "Price", window.EmjiveSelection.formatPrice(details.price || 0));
    appendSpecRow(dl, "Weight", details.weight || "—");
    appendSpecRow(dl, "Composition", details.composition || "—");
  }

  function appendSpecRow(dl, label, value) {
    dl.appendChild(el("dt", null, label));
    dl.appendChild(el("dd", null, value));
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  /* ---- 4 + size modal + selection ---------------------------------------- */

  function wireSelectButton(product) {
    var selectBtn = document.getElementById("selectButton");
    // Sizes are a property of the category (all rings share one size run,
    // all necklaces would share another, etc.), not of the individual
    // product — and the category vocabulary is global rather than
    // per-series, so this resolves identically whichever series the product
    // lives in. See data/series.json's top-level "categories".
    var info = window.EmjiveSeries.categoryInfo(product.category);
    var sizes = info.sizes || [];
    var unit = info.unit || "";

    var standardRow = document.getElementById("sizeModalStandardRow");
    var standardWrap = document.getElementById("sizeModalStandardOptions");
    var customRow = document.getElementById("sizeModalCustomRow");
    var customInput = document.getElementById("sizeModalCustomInput");
    var customUnit = document.getElementById("sizeModalCustomUnit");
    var guideToggle = document.getElementById("sizeModalGuideToggle");
    var guidePanel = document.getElementById("sizeModalGuide");
    var confirmBtn = document.getElementById("sizeModalConfirm");

    // Nothing sizeable about this category at all yet — same disabled
    // fallback as before, now gated on sizes AND a unit rather than just
    // sizes (a category could have only a custom-size unit and no
    // standard run, or vice versa).
    if (!sizes.length && !unit) {
      selectBtn.disabled = true;
      selectBtn.textContent = "No sizes available";
      return;
    }

    customUnit.textContent = unit;
    standardRow.hidden = sizes.length === 0;

    var modal = document.getElementById("sizeModal");

    // Nudge is the confirm button's own label/prompt crossfade (see
    // .size-modal__confirm-label/-nudge in css/style.css) — cleared
    // whenever selection state actually changes, not just left to expire
    // on its own timer, so it never lingers stale once a size is picked.
    var nudgeTimer = null;
    function resetNudge() {
      confirmBtn.classList.remove("is-nudging");
      clearTimeout(nudgeTimer);
    }

    function clearSelection() {
      state.selectedSize = null;
      resetNudge();
      standardWrap.querySelectorAll(".size-modal__standard-option").forEach(function (b) {
        b.classList.remove("is-selected");
      });
      customRow.classList.remove("is-selected");
    }

    function selectStandard(size, btn) {
      state.selectedSize = size;
      resetNudge();
      standardWrap.querySelectorAll(".size-modal__standard-option").forEach(function (b) {
        b.classList.toggle("is-selected", b === btn);
      });
      customRow.classList.remove("is-selected");
      customInput.value = "";
    }

    standardWrap.innerHTML = "";
    sizes.forEach(function (size) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "size-modal__standard-option";
      btn.textContent = size;
      btn.addEventListener("click", function () { selectStandard(size, btn); });
      standardWrap.appendChild(btn);
    });

    // Digits and at most one decimal point — inputmode="decimal" on the
    // element itself is what actually triggers the numeric-only keypad on
    // mobile; this just backstops desktop typing/paste.
    customInput.addEventListener("input", function () {
      var cleaned = customInput.value.replace(/[^0-9.]/g, "");
      var firstDot = cleaned.indexOf(".");
      if (firstDot !== -1) {
        cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
      }
      customInput.value = cleaned;
      if (cleaned) {
        state.selectedSize = cleaned;
        resetNudge();
        customRow.classList.add("is-selected");
        standardWrap.querySelectorAll(".size-modal__standard-option").forEach(function (b) {
          b.classList.remove("is-selected");
        });
      } else {
        clearSelection();
      }
    });

    guideToggle.addEventListener("click", function () {
      guidePanel.classList.toggle("is-open");
    });

    function openModal() {
      clearSelection();
      customInput.value = "";
      guidePanel.classList.remove("is-open");
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("is-modal-open");
    }

    function closeModal() {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("is-modal-open");
    }

    selectBtn.addEventListener("click", openModal);
    document.getElementById("sizeModalBackdrop").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
    });

    confirmBtn.addEventListener("click", function () {
      if (!state.selectedSize) {
        confirmBtn.classList.add("is-nudging");
        clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(function () {
          confirmBtn.classList.remove("is-nudging");
        }, 2000);
        return;
      }
      var details = (product.metalDetails && product.metalDetails[state.selectedMetal]) || {};
      window.EmjiveSelection.addItem({
        // Which series this came from — product ids are only unique within
        // one, so the id alone no longer identifies a piece.
        series: state.seriesSlug,
        productId: product.id,
        name: product.name,
        category: product.category,
        metal: state.selectedMetal,
        size: state.selectedSize,
        price: details.price || 0,
        image: (product.icons && product.icons[state.selectedMetal]) || ""
      });
      closeModal();
    });
  }

  wireCarouselNav();
  init();
})();
