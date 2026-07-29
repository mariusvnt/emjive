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
    link.href = "index.html#products";
    loadingEl.appendChild(link);
  }

  function init() {
    fetch("data/products.json")
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load products.json");
        return res.json();
      })
      .then(function (data) {
        var id = getIdFromQuery();
        var product = (data.products || []).find(function (p) { return p.id === id; });
        state.metals = data.metals || [];
        state.sizesByCategory = data.sizesByCategory || {};
        state.sizeUnits = data.sizeUnits || {};
        if (!product) return showNotFound();
        state.product = product;
        render(product);
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
    if (product.model) {
      // window.EmjiveModelViewer is exposed by js/three-viewer.js — reused
      // here so the viewer construction/material logic lives in exactly
      // one place.
      state.modelHandle = window.EmjiveModelViewer(product, state.selectedMetal);
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

  function applyOffset(offsetPx, animate) {
    var track = document.getElementById("productCarouselTrack");
    track.style.transition = animate ? "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    track.style.transform = "translateX(" + offsetPx + "px)";
    state.scrollOffset = offsetPx;
  }

  // The rims aren't a fixed size — each one spans the whole run of empty
  // space between the screen edge and whichever tile is currently closest
  // to centered (the "active" one), so previous/next is clickable
  // anywhere in that runway, not just a thin strip at the very edge. Only
  // called at rest (after a render, a resize, a rim click, or a drag
  // settles) — while actively dragging, the viewport has pointer capture
  // anyway, so the rims can't be clicked until it ends.
  function updateRims() {
    if (state.slideCount <= 1) return;
    var bounds = computeBounds();
    var tile = measureTileWidth();
    var index = Math.round((bounds.max - state.scrollOffset) / tile);
    index = Math.max(0, Math.min(state.slideCount - 1, index));
    var tileLeft = index * tile + state.scrollOffset;
    var tileRight = tileLeft + tile;
    var leftWidth = Math.max(0, Math.min(bounds.width, tileLeft));
    var rightWidth = Math.max(0, Math.min(bounds.width, bounds.width - tileRight));
    document.getElementById("carouselRimLeft").style.width = leftWidth + "px";
    document.getElementById("carouselRimRight").style.width = rightWidth + "px";
  }

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
    updateRims();
  }

  function scrollByTiles(direction) {
    if (state.slideCount <= 1) return;
    var bounds = computeBounds();
    var tile = measureTileWidth();
    var target = Math.max(bounds.min, Math.min(bounds.max, state.scrollOffset - direction * tile));
    applyOffset(target, true);
    updateRims();
  }

  // WebKit-style rubber-band damping for drag-past-the-bounds overshoot,
  // at either end — the further past a bound you drag, the harder it gets
  // to pull further, rather than tracking the pointer 1:1.
  function rubberBand(overshoot, dimension) {
    var c = 0.55;
    return (overshoot * dimension * c) / (dimension + c * overshoot);
  }

  // No visible arrows: navigation is either a short tap/click on the
  // left/right rim (invisible edge zones, always present in the markup),
  // which scrolls by one tile-width, or a real drag — starting on a rim
  // or directly on the filmstrip — to any position freely, no snapping to
  // a discrete "active slide". The rims need the SAME drag handling as
  // the viewport itself (not just a click listener) since they visually
  // sit on top of it (z-index: 2, covering part of its area) and would
  // otherwise swallow pointerdown before a drag starting there ever
  // reached the viewport. Wired once here, since the viewport/track/rim
  // elements are static markup in product.html — only the slides inside
  // the track change per product.
  function wireCarouselNav() {
    var rimLeft = document.getElementById("carouselRimLeft");
    var rimRight = document.getElementById("carouselRimRight");
    var viewport = document.querySelector(".product-carousel__viewport");
    var surfaces = [viewport, rimLeft, rimRight];

    // Keyboard-only fallback (Tab, then Enter/Space) — real pointer taps
    // are handled entirely below instead. A mouse (unlike touch) still
    // fires a native click after pointerup on a <button> regardless of
    // how far it moved in between, so without suppressClick this would
    // double-fire on top of endDrag's own handling of the same tap/drag.
    rimLeft.addEventListener("click", function () {
      if (suppressClick) return;
      scrollByTiles(-1);
    });
    rimRight.addEventListener("click", function () {
      if (suppressClick) return;
      scrollByTiles(1);
    });

    // Otherwise a mouse drag starting on a photo kicks off the browser's
    // own native image-drag-and-drop gesture (desktop only — touch drags
    // don't trigger it), which fights with the custom pointer-drag scroll
    // below. img.draggable = false (set in buildImageSlide) covers real
    // <img> slides; this covers anything else a browser might still try
    // to drag (e.g. the 3D viewer's poster image while it's loading).
    surfaces.forEach(function (surface) {
      surface.addEventListener("dragstart", function (e) { e.preventDefault(); });
    });

    var dragging = false;
    var dragStartX = 0;
    var dragStartOffset = 0;
    var dragBounds = null;
    var dragSurface = null;
    // True for the brief window after endDrag has already acted on a
    // rim-originated tap/drag itself, covering the native click that
    // still follows right behind it (see the click listeners above).
    // Cleared on the next tick regardless, in case that click never
    // actually fires (e.g. the release lands outside the rim's bounds).
    var suppressClick = false;
    // Below this much pointer movement, a release counts as a tap (fires
    // the rim's scroll-by-one-tile action if it started on one) rather
    // than a drag — same threshold js/main.js's wireModelClickNavigation
    // uses for the equivalent click-vs-drag problem on the 3D models.
    var TAP_THRESHOLD = 6;
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
      dragging = true;
      dragSurface = e.currentTarget;
      dragStartX = e.clientX;
      dragStartOffset = state.scrollOffset;
      dragLastX = e.clientX;
      dragLastT = e.timeStamp;
      dragVelocity = 0;
      applyOffset(state.scrollOffset, false); // kill any in-flight transition
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      var raw = dragStartOffset + (e.clientX - dragStartX);
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
      if (!dragging) return;
      dragging = false;
      if (dragSurface === rimLeft || dragSurface === rimRight) {
        // Whatever happens below already IS this interaction's full
        // handling — the click that's about to follow on the rim button
        // would just repeat it (see the click listeners above).
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
      }
      if (Math.abs(e.clientX - dragStartX) < TAP_THRESHOLD) {
        // A tap, not a drag — snap back to exactly where we started (any
        // sub-threshold jitter already applied via onPointerMove) and
        // fire the surface's own tap action, if it has one.
        applyOffset(dragStartOffset, false);
        if (dragSurface === rimLeft) scrollByTiles(-1);
        else if (dragSurface === rimRight) scrollByTiles(1);
      } else {
        // Subtle inertia: coast a little further in the direction/speed
        // of the last few pixels of drag rather than stopping dead where
        // the pointer happened to lift, still clamped into the same
        // bounds a plain release already respects (so it can't fling
        // past either end — no separate rubber-band needed here). Kept
        // deliberately small (capped at well under half a tile) so it
        // reads as a gentle coast, not a mobile-style long-distance flick.
        var MOMENTUM_TIME = 120; // ms
        var momentumCap = measureTileWidth() * 0.4;
        var momentum = Math.max(-momentumCap, Math.min(momentumCap, dragVelocity * MOMENTUM_TIME));
        var target = Math.max(dragBounds.min, Math.min(dragBounds.max, state.scrollOffset + momentum));
        applyOffset(target, true); // also springs back if it was rubber-banded past either end
        updateRims();
      }
    }

    surfaces.forEach(function (surface) {
      surface.addEventListener("pointerdown", onPointerDown);
      surface.addEventListener("pointermove", onPointerMove);
      surface.addEventListener("pointerup", endDrag);
      surface.addEventListener("pointercancel", endDrag);
    });

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
    // product — looked up from state.sizesByCategory/state.sizeUnits rather
    // than stored per-product in products.json.
    var sizes = state.sizesByCategory[product.category] || [];
    var unit = state.sizeUnits[product.category] || "";

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

    function clearSelection() {
      state.selectedSize = null;
      confirmBtn.disabled = true;
      standardWrap.querySelectorAll(".size-modal__standard-option").forEach(function (b) {
        b.classList.remove("is-selected");
      });
      customRow.classList.remove("is-selected");
    }

    function selectStandard(size, btn) {
      state.selectedSize = size;
      confirmBtn.disabled = false;
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
        confirmBtn.disabled = false;
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
      if (!state.selectedSize) return;
      var details = (product.metalDetails && product.metalDetails[state.selectedMetal]) || {};
      window.EmjiveSelection.addItem({
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
