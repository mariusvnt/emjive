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
  var revealScanHint = document.getElementById("revealScanHint");

  if (revealSection && revealXrayGroup && revealNormal && revealFrontier && revealScanHint) {
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
        revealScanHint.style.clipPath = "inset(0 0 0 0)";
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

        // "Scroll to scan" sits fixed at the pin's vertical middle (see
        // .reveal__scan-hint's top: 50%) — erase it from its own bottom
        // edge upward in lockstep with the SAME boundary revealing the
        // x-ray beneath it, over the scroll range where that boundary is
        // actually crossing the text's own height, rather than a plain
        // opacity fade or an arbitrary cutoff. getBoundingClientRect()
        // gives its layout box, unaffected by clip-path, so top/bottom
        // stay stable across frames even as it progressively clips away.
        //
        // Driven by the frontier band's own TOP edge (revealedPct plus
        // its height), not revealedPct (its bottom edge) directly: the
        // band has real thickness, and using its bottom edge left a
        // persistent gap the width of that thickness where the
        // still-visible text and the band's backdrop-filter both applied
        // to the same pixels — .reveal__frontier's invert(1) on top of
        // .reveal__scan-hint's own mix-blend-mode: difference, compounding
        // into a double-inversion instead of a single clean one. Erasing
        // ahead of the band's leading edge means nothing is left for the
        // band to double-invert by the time it actually reaches a given
        // pixel.
        var hintRect = revealScanHint.getBoundingClientRect();
        var hintTopPct = ((window.innerHeight - hintRect.top) / window.innerHeight) * 100;
        var hintBottomPct = ((window.innerHeight - hintRect.bottom) / window.innerHeight) * 100;
        var frontierHeightPct = (revealFrontier.getBoundingClientRect().height / window.innerHeight) * 100;
        var frontierLeadingPct = revealedPct + frontierHeightPct;
        var hintErasedPct;
        if (frontierLeadingPct <= hintBottomPct) {
          hintErasedPct = 0;
        } else if (frontierLeadingPct >= hintTopPct) {
          hintErasedPct = 100;
        } else {
          hintErasedPct = ((frontierLeadingPct - hintBottomPct) / (hintTopPct - hintBottomPct)) * 100;
        }
        revealScanHint.style.clipPath = "inset(0 0 " + hintErasedPct + "% 0)";
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

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  // A real click (near-zero pointer movement between down and up) opens
  // href; a drag past DRAG_THRESHOLD is left alone since that's the
  // viewer's own TrackballControls rotating the model (js/three-viewer.js).
  // Distance-based rather than a plain "click" listener because a click
  // still fires at the end of a rotate-drag as long as the pointer lifts
  // over the same element, which would otherwise navigate away every time
  // someone just wanted to spin the model.
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

    // No metal picker on the homepage grid — always the product's own
    // default metal (product.metal). window.EmjiveModelViewer is exposed
    // by js/three-viewer.js — reused here so the viewer construction/
    // material logic lives in exactly one place.
    var gridIcon = product.icons && product.icons[product.metal];
    if (product.model) {
      var modelHandle = window.EmjiveModelViewer(product, product.metal);
      wireModelClickNavigation(modelHandle.el, href);
      figure.appendChild(modelHandle.el);
    } else if (gridIcon) {
      var img = el("img");
      img.src = gridIcon;
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
