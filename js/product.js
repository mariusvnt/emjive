/* ==========================================================================
   J&MV — product detail page
   Resolves ?id= against data/products.json and renders the label, carousel,
   metal picker, description, characteristics and size/cart flow.
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
    selectedMetal: null,
    selectedSize: null,
    slideCount: 0,
    activeSlide: 0,
    modelHandle: null
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
  }

  /* ---- 1. label ------------------------------------------------------- */

  function renderLabel(product) {
    document.getElementById("productLabelName").textContent = product.name || "";
    document.getElementById("productLabelType").textContent =
      product.category ? "." + product.category.toLowerCase() : "";

    // Prefer a real photo (images[0]) over the grid's placeholder/poster
    // image field — no thumbnail at all if neither exists (Foramen/Disc
    // today), rather than showing a broken or placeholder image.
    var thumb = document.getElementById("productLabelThumb");
    var thumbSrc = (product.images && product.images[0]) || product.image || "";
    if (thumbSrc) {
      thumb.src = thumbSrc;
      thumb.hidden = false;
    } else {
      thumb.hidden = true;
    }

    renderLabelPrice(product);
  }

  function renderLabelPrice(product) {
    var details = (product.metalDetails && product.metalDetails[state.selectedMetal]) || {};
    document.getElementById("productLabelPrice").textContent =
      window.EmjiveCart.formatPrice(details.price || 0);
  }

  /* ---- 2. carousel ------------------------------------------------------ */

  function renderCarousel(product) {
    var track = document.getElementById("productCarouselTrack");
    var carousel = document.getElementById("productCarousel");
    track.innerHTML = "";

    var slideSources = [];
    if (product.model) {
      // window.EmjiveModelViewer is exposed by js/main.js — reused here so
      // the model-viewer setup/material logic lives in exactly one place.
      state.modelHandle = window.EmjiveModelViewer(product, state.selectedMetal);
      // Smaller than the photo slides on purpose — leaves generous empty
      // space around the model to drag/swipe the carousel from without
      // that drag landing on model-viewer's own camera-controls instead.
      var modelSlide = el("div", "product-carousel__slide product-carousel__slide--model");
      modelSlide.appendChild(state.modelHandle.el);
      track.appendChild(modelSlide);
      slideSources.push("model");
    } else if (product.image) {
      track.appendChild(buildImageSlide(product.image, product.name));
      slideSources.push(product.image);
    }

    (product.images || []).forEach(function (src) {
      track.appendChild(buildImageSlide(src, product.name));
      slideSources.push(src);
    });

    state.slideCount = slideSources.length;
    carousel.classList.toggle("product-carousel--single", state.slideCount <= 1);
    goToSlide(0);
  }

  function buildImageSlide(src, alt) {
    var slide = el("div", "product-carousel__slide");
    var img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    img.loading = "lazy";
    slide.appendChild(img);
    return slide;
  }

  function goToSlide(index) {
    if (state.slideCount === 0) return;
    // Clamped, not wrapped — going past either end just stays put instead
    // of looping around to the other side.
    var clamped = Math.max(0, Math.min(state.slideCount - 1, index));
    state.activeSlide = clamped;
    var offset = carouselOffsetPercent(state.slideCount, clamped);
    document.getElementById("productCarouselTrack").style.transform =
      "translateX(" + offset + "%)";
  }

  // 76% slide width + 4% margin (80% step), kept in sync with
  // .product-carousel__slide in css/style.css. The 12% base offset centers
  // the active slide in the viewport, leaving the start of the previous
  // and next slide peeking in on either side. Single-slide products (no
  // extra images[]) use the flush 100% step / no offset instead, matching
  // .product-carousel--single.
  var CAROUSEL_STEP = 80;
  var CAROUSEL_CENTER_OFFSET = 12;

  function carouselOffsetPercent(slideCount, index) {
    if (slideCount <= 1) return 0;
    return CAROUSEL_CENTER_OFFSET - index * CAROUSEL_STEP;
  }

  // No visible arrows: navigation is either clicking the left/right rim
  // (invisible edge buttons, always present in the markup) or dragging
  // horizontally. Wired once here, since the viewport/track/rim elements
  // are static markup in product.html — only the slides inside the track
  // change per product.
  function wireCarouselNav() {
    document.getElementById("carouselRimLeft").addEventListener("click", function () {
      goToSlide(state.activeSlide - 1);
    });
    document.getElementById("carouselRimRight").addEventListener("click", function () {
      goToSlide(state.activeSlide + 1);
    });

    var viewport = document.querySelector(".product-carousel__viewport");
    var track = document.getElementById("productCarouselTrack");
    var dragging = false;
    var startX = 0;
    var viewportWidth = 0;

    viewport.addEventListener("pointerdown", function (e) {
      // A drag that starts on the 3D model slide should rotate the model
      // (model-viewer's own camera-controls), not page the carousel.
      if (state.slideCount <= 1 || e.target.closest("model-viewer")) return;
      dragging = true;
      startX = e.clientX;
      viewportWidth = viewport.getBoundingClientRect().width;
      track.style.transition = "none";
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var deltaPercent = ((e.clientX - startX) / viewportWidth) * 100;
      var base = carouselOffsetPercent(state.slideCount, state.activeSlide);
      track.style.transform = "translateX(" + (base + deltaPercent) + "%)";
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      track.style.transition = "";
      var deltaPx = e.clientX - startX;
      var threshold = viewportWidth * 0.15;
      if (deltaPx > threshold) {
        goToSlide(state.activeSlide - 1);
      } else if (deltaPx < -threshold) {
        goToSlide(state.activeSlide + 1);
      } else {
        goToSlide(state.activeSlide);
      }
    }

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
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
    renderSpecs(product);
    renderLabelPrice(product);
  }

  /* ---- 6. characteristics (metal-dependent) ------------------------------ */

  function renderSpecs(product) {
    var details = (product.metalDetails && product.metalDetails[state.selectedMetal]) || {};
    var dl = document.getElementById("productSpecs");
    dl.innerHTML = "";
    appendSpecRow(dl, "Metal", capitalize(state.selectedMetal));
    appendSpecRow(dl, "Price", window.EmjiveCart.formatPrice(details.price || 0));
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

  /* ---- 4 + size modal + cart --------------------------------------------- */

  function wireSelectButton(product) {
    var selectBtn = document.getElementById("selectButton");
    var sizes = product.sizes || [];

    if (!sizes.length) {
      selectBtn.disabled = true;
      selectBtn.textContent = "No sizes available";
      return;
    }

    var modal = document.getElementById("sizeModal");
    var optionsWrap = document.getElementById("sizeModalOptions");
    var confirmBtn = document.getElementById("sizeModalConfirm");

    optionsWrap.innerHTML = "";
    state.selectedSize = null;
    confirmBtn.disabled = true;

    sizes.forEach(function (size) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "size-modal__option";
      btn.textContent = size;
      btn.addEventListener("click", function () {
        state.selectedSize = size;
        optionsWrap.querySelectorAll(".size-modal__option").forEach(function (b) {
          b.classList.toggle("is-selected", b === btn);
        });
        confirmBtn.disabled = false;
      });
      optionsWrap.appendChild(btn);
    });

    function openModal() {
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
    document.getElementById("sizeModalClose").addEventListener("click", closeModal);
    document.getElementById("sizeModalBackdrop").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
    });

    confirmBtn.addEventListener("click", function () {
      if (!state.selectedSize) return;
      var details = (product.metalDetails && product.metalDetails[state.selectedMetal]) || {};
      window.EmjiveCart.addItem({
        productId: product.id,
        name: product.name,
        category: product.category,
        metal: state.selectedMetal,
        size: state.selectedSize,
        price: details.price || 0,
        image: product.image || ""
      });
      window.location.href = "cart.html";
    });
  }

  wireCarouselNav();
  init();
})();
