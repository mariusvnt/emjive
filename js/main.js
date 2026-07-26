/* ==========================================================================
   J&MV — site behaviour
   Renders products.json into the grid, plus small UI interactions.
   ========================================================================== */

(function () {
  "use strict";

  /* ---- header menu toggle ------------------------------------------------- */

  var menuToggle = document.getElementById("menuToggle");
  var siteHeaderMenu = document.getElementById("siteHeaderMenu");

  function setHeaderMenuOpen(isOpen) {
    menuToggle.classList.toggle("is-open", isOpen);
    siteHeaderMenu.classList.toggle("is-open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  }

  if (menuToggle && siteHeaderMenu) {
    menuToggle.addEventListener("click", function () {
      setHeaderMenuOpen(!menuToggle.classList.contains("is-open"));
    });

    siteHeaderMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setHeaderMenuOpen(false);
      });
    });
  }

  /* ---- entry reveal: frontier band lift, then scroll-driven x-ray wipe --- */

  var revealSection = document.getElementById("revealSection");
  var revealXrayGroup = document.getElementById("revealXrayGroup");
  var revealNormal = revealSection ? revealSection.querySelector(".reveal__img--normal") : null;
  var revealFrontier = document.getElementById("revealFrontier");

  if (revealSection && revealXrayGroup && revealNormal && revealFrontier) {
    var revealTicking = false;

    function updateReveal() {
      revealTicking = false;
      var rect = revealSection.getBoundingClientRect();
      // Clamped to >= 0: on mobile browsers, CSS vh and window.innerHeight
      // can briefly disagree (dynamic address bar resizing the viewport),
      // which could otherwise make this negative and fall through to the
      // "fully revealed" branch below even at scroll position 0.
      var totalScroll = Math.max(0, rect.height - window.innerHeight);
      var scrolled = totalScroll > 0 ? Math.min(totalScroll, Math.max(0, -rect.top)) : 0;

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
    }

    function requestRevealUpdate() {
      if (!revealTicking) {
        revealTicking = true;
        requestAnimationFrame(updateReveal);
      }
    }

    window.addEventListener("scroll", requestRevealUpdate, { passive: true });
    window.addEventListener("resize", requestRevealUpdate);
    updateReveal();
  }

  /* ---- product grid ------------------------------------------------------ */

  var grid = document.getElementById("productGrid");

  // PBR material presets applied to every mesh of a product's 3D model,
  // regardless of the model's own original materials/textures. Pick one
  // per product via the "metal" field in products.json (defaults to
  // "steel" if omitted or unrecognized). Keys here should match the
  // top-level "metals" list in products.json — that list is the source
  // of truth for which metal names are valid, so keep the two in sync.
  var METAL_PRESETS = {
    steel: { baseColorFactor: [0.72, 0.73, 0.75, 1], metallicFactor: 1.0, roughnessFactor: 0.22 },
    silver: { baseColorFactor: [0.6, 0.62, 0.64, 1], metallicFactor: 1.0, roughnessFactor: 0.28 },
    bronze: { baseColorFactor: [0.55, 0.36, 0.2, 1], metallicFactor: 0.9, roughnessFactor: 0.35, exposure: "1.05" }
  };

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  // Once the visitor has actually dragged/rotated any one model — on this
  // page or any earlier one this session (e.g. the grid, then a product
  // page, then back to the grid) — every model-viewer's idle "wiggle"
  // hint gets turned off. They've already learned it's draggable, no
  // need to keep nudging them. sessionStorage (not localStorage) so it's
  // remembered for revisits within the same browsing session but doesn't
  // permanently disable it for a brand new visit days later.
  var INTERACTION_PROMPT_SEEN_KEY = "emjive_model_interacted";
  var interactionPromptSuppressed = false;
  try {
    interactionPromptSuppressed = sessionStorage.getItem(INTERACTION_PROMPT_SEEN_KEY) === "1";
  } catch (e) {
    // sessionStorage unavailable (private browsing, etc.) — just falls
    // back to per-page-load behavior instead of remembering across nav.
  }
  var allModelViewers = [];

  function suppressInteractionPromptEverywhere() {
    interactionPromptSuppressed = true;
    allModelViewers.forEach(function (viewer) {
      viewer.setAttribute("interaction-prompt", "none");
    });
    try {
      sessionStorage.setItem(INTERACTION_PROMPT_SEEN_KEY, "1");
    } catch (e) {
      // Ignore — worst case it just won't be remembered on the next page.
    }
  }

  // Builds a <model-viewer> for a product and returns a handle so callers
  // (the homepage grid, and the product detail page's carousel) can swap
  // its metal finish later without reloading the .glb or losing whatever
  // camera angle the visitor left it at. Shared here (rather than
  // duplicated in js/product.js) so there's exactly one place that knows
  // the model-viewer attributes/material logic — exposed as
  // window.EmjiveModelViewer at the bottom of this file.
  function buildModelViewer(product, metalKey) {
    var mv = document.createElement("model-viewer");
    mv.setAttribute("src", product.model);
    if (product.image) mv.setAttribute("poster", product.image);
    mv.setAttribute("alt", product.name || "");
    mv.setAttribute("camera-controls", "");
    mv.setAttribute("disable-zoom", "");
    mv.setAttribute("shadow-intensity", "0");
    // model-viewer's built-in "wiggle" hint (nudges the camera to show the
    // model is draggable) defaults to appearing after only 3s idle, and
    // re-appears often — bumped up since it was showing too frequently.
    mv.setAttribute("interaction-prompt-threshold", "5000");
    if (interactionPromptSuppressed) mv.setAttribute("interaction-prompt", "none");
    allModelViewers.push(mv);
    // Detected via our own pointer tracking (not model-viewer's
    // camera-change event) so it doesn't depend on that event's detail
    // shape matching what we expect — a real drag (movement past a small
    // threshold while the pointer is down) means the visitor rotated it.
    var dragStartX = null;
    var dragStartY = null;
    mv.addEventListener("pointerdown", function (e) {
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    });
    mv.addEventListener("pointermove", function (e) {
      if (interactionPromptSuppressed || dragStartX === null) return;
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;
      if (Math.sqrt(dx * dx + dy * dy) > 6) suppressInteractionPromptEverywhere();
    });
    mv.addEventListener("pointerup", function () {
      dragStartX = null;
      dragStartY = null;
    });
    // A real studio HDRI instead of model-viewer's flat built-in
    // "neutral" IBL — metals are mostly just reflecting the environment,
    // so this matters more than the material numbers for getting a rich,
    // Blender-like result. Downscaled + converted from the original
    // 8k/300MB EXR source (assets/studio_kontrast_04_8k.exr) to a
    // web-friendly 1024px-wide .hdr — three.js's EXR loader rejected the
    // re-encoded EXR outright, Radiance .hdr worked without issue.
    mv.setAttribute("environment-image", "assets/hdri/studio_kontrast_04_1k.hdr");

    // Default view: falls back to model-viewer's own default framing
    // ("0deg 75deg 105%") if the product doesn't specify one.
    var defaultOrbit = product.cameraOrbit || "0deg 75deg 105%";
    var dragDecay = "200";   // snappy while the user is actively rotating
    var returnDecay = "1000"; // slow ease-back once they let go
    mv.setAttribute("camera-orbit", defaultOrbit);
    mv.setAttribute("interpolation-decay", dragDecay);
    if (product.cameraTarget) mv.setAttribute("camera-target", product.cameraTarget);

    // currentMetal is read by the "load" listener below, and also by
    // applyMetal() once the model has already loaded — this is what lets
    // a metal switch after load re-run the same material assignment.
    var currentMetal = metalKey;
    var modelLoaded = false;

    function applyToModel() {
      var metal = METAL_PRESETS[currentMetal] || METAL_PRESETS.steel;
      mv.setAttribute("exposure", metal.exposure || "1");
      mv.model.materials.forEach(function (material) {
        material.pbrMetallicRoughness.setBaseColorFactor(metal.baseColorFactor);
        material.pbrMetallicRoughness.setMetallicFactor(metal.metallicFactor);
        material.pbrMetallicRoughness.setRoughnessFactor(metal.roughnessFactor);
      });
    }

    mv.setAttribute("exposure", (METAL_PRESETS[currentMetal] || METAL_PRESETS.steel).exposure || "1");
    mv.addEventListener("load", function () {
      modelLoaded = true;
      applyToModel();
    });

    // Wait a second after release before easing back to the default view
    // (then switch interpolation back to snappy for the next drag). If the
    // user grabs the model again before that second is up, the pending
    // reset is cancelled instead of fighting the new drag.
    var resetTimeoutId = null;

    mv.addEventListener("pointerdown", function () {
      if (resetTimeoutId) {
        clearTimeout(resetTimeoutId);
        resetTimeoutId = null;
      }
    });

    mv.addEventListener("pointerup", function () {
      if (resetTimeoutId) clearTimeout(resetTimeoutId);
      resetTimeoutId = setTimeout(function () {
        resetTimeoutId = null;
        mv.setAttribute("interpolation-decay", returnDecay);
        mv.cameraOrbit = defaultOrbit;
        setTimeout(function () {
          mv.setAttribute("interpolation-decay", dragDecay);
        }, 1200);
      }, 1000);
    });

    return {
      el: mv,
      applyMetal: function (newMetalKey) {
        currentMetal = newMetalKey;
        if (modelLoaded) applyToModel();
      }
    };
  }

  // A real click (near-zero pointer movement between down and up) opens
  // href; a drag past DRAG_THRESHOLD is left alone since that's
  // model-viewer's own camera-controls rotating the model. Distance-based
  // rather than a plain "click" listener because a click still fires at
  // the end of a rotate-drag as long as the pointer lifts over the same
  // element, which would otherwise navigate away every time someone just
  // wanted to spin the model.
  function wireModelClickNavigation(mv, href) {
    var DRAG_THRESHOLD = 6;
    var startX = 0;
    var startY = 0;

    mv.addEventListener("pointerdown", function (e) {
      startX = e.clientX;
      startY = e.clientY;
    });

    mv.addEventListener("pointerup", function (e) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) {
        window.location.href = href;
      }
    });
  }

  function buildCard(product) {
    var card = el("article", "product-card");
    var figure = el("div", "product-card__figure");
    var href = "product.html?id=" + encodeURIComponent(product.id);

    if (product.model) {
      var modelHandle = buildModelViewer(product, product.metal);
      wireModelClickNavigation(modelHandle.el, href);
      figure.appendChild(modelHandle.el);
    } else if (product.image) {
      var img = el("img");
      img.src = product.image;
      img.alt = product.name || "";
      img.loading = "lazy";
      figure.appendChild(img);
    }

    // The white divider bar itself IS the link (not a separate decorative
    // element with an invisible link layered on top) — clicking anywhere
    // on it opens the product page. aria-hidden/tabindex=-1 since it's a
    // same-destination duplicate of .product-card__label below; that one
    // stays the real keyboard-reachable link.
    var barLink = document.createElement("a");
    barLink.className = "product-card__bar-link";
    barLink.href = href;
    barLink.setAttribute("aria-hidden", "true");
    barLink.setAttribute("tabindex", "-1");
    card.appendChild(barLink);

    card.appendChild(figure);

    if (product.name) {
      var label = document.createElement("a");
      label.className = "product-card__label";
      label.href = href;
      label.appendChild(el("span", "product-card__label-name", product.name));
      if (product.category) {
        label.appendChild(el("span", "product-card__label-type", "." + product.category.toLowerCase()));
      }
      card.appendChild(label);
    }

    return card;
  }

  window.EmjiveModelViewer = buildModelViewer;

  function renderProducts(products) {
    grid.innerHTML = "";
    if (!products.length) {
      grid.appendChild(el("p", "product-grid__loading", "No products yet — add some to data/products.json"));
      return;
    }
    products.forEach(function (product) {
      grid.appendChild(buildCard(product));
    });
  }

  if (grid) {
    fetch("data/products.json")
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load products.json");
        return res.json();
      })
      .then(function (data) {
        renderProducts(data.products || []);
      })
      .catch(function (err) {
        grid.innerHTML = "";
        grid.appendChild(el("p", "product-grid__loading",
          "Couldn't load products — if you're opening this file directly in a browser, run a local server instead (see README). " + err.message));
      });
  }

  /* ---- contact form stub -------------------------------------------------- */

  var contactForm = document.getElementById("contactForm");
  if (contactForm) {
    contactForm.addEventListener("submit", function (e) {
      e.preventDefault();
      alert("This form isn't connected yet. Wire it up to a form service (Formspree, Netlify Forms, etc.) — see README.");
    });
  }
})();
