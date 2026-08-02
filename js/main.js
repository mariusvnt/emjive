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
  // Not scoped to revealSection — the floating selection bar is a
  // sibling built by js/selection-bar.js (or absent, e.g. on a page
  // without a hero at all), not a descendant of it.
  var selectionBar = document.querySelector(".selection-bar");
  // Fixed, so it visually sits (z-index 80) over whatever scrolls
  // underneath it — used below to start the bar's entrance the instant
  // the frontier band's own leading edge would otherwise disappear
  // behind it, rather than waiting for the band to reach the literal top
  // of the viewport (which, on any screen with a header, it never
  // visibly does — it's already hidden behind the header well before that).
  var siteHeader = document.querySelector(".site-header");
  // The summary row specifically, not .selection-bar as a whole, for the
  // reveal-distance measurement below — .selection-bar's own rendered
  // height grows whenever its drawer is open, which would otherwise make
  // "how far to scroll" fluctuate with unrelated drawer state instead of
  // staying tied to the one constant, always-visible part of the bar.
  var selectionBarSummary = selectionBar ? selectionBar.querySelector(".selection-bar__summary") : null;

  if (revealSection && revealXrayGroup && revealNormal && revealFrontier) {
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

      // The floating selection bar's entrance, continuing directly off
      // the point where the frontier band's leading edge would pass
      // behind the fixed header — not where the wipe hits 100%, which
      // is where the band reaches the literal top of the viewport,
      // already invisible (covered by the header, z-index 80 vs. the
      // band's own 2) well before that point on any page with one. Same
      // technique as liftDistance/wipeDistance/wipeProgress just above
      // (measure the real element, turn a scroll distance into a 0-1
      // progress): the band's own bottom edge sits at screen-Y =
      // innerHeight * (1 - wipeProgress) while riding the wipe (the
      // "bottom: X%" set on it above, expressed against that same
      // window height), so solving for the wipeProgress at which that
      // equals the header's own height gives the exact scroll position
      // this phase should start from, however tall the header happens
      // to be at the current viewport width — falls back to the literal
      // wipe-complete point (headerHeight 0) if there's no header on
      // this page at all.
      if (selectionBar && selectionBarSummary) {
        var headerHeight = siteHeader ? siteHeader.getBoundingClientRect().height : 0;
        var wipeProgressAtHeader = window.innerHeight > 0 ? Math.max(0, 1 - headerHeight / window.innerHeight) : 1;
        var barTriggerScroll = liftDistance + wipeProgressAtHeader * wipeDistance;

        // Continuing directly off that trigger point rather than
        // switching to a separate, time-based animation: using the
        // bar's own height as the phase's scroll distance means the
        // same scroll motion that just finished revealing the hand also
        // physically pushes the bar up from below the viewport, at
        // roughly a 1:1 scroll-to-pixel rate. No transition on the CSS
        // side at all (see .selection-bar's own comment) — every value
        // here is set directly per scroll frame, in both directions, so
        // scrolling back up past the trigger point un-reveals it exactly
        // as readily as scrolling down past it revealed it.
        var pastHeroScroll = Math.max(0, rawScrolled - barTriggerScroll);
        var barRevealDistance = Math.max(selectionBarSummary.getBoundingClientRect().height, 1);
        var barProgress = totalScroll > 0 ? Math.min(1, pastHeroScroll / barRevealDistance) : 1;
        selectionBar.style.transform = "translateY(" + (100 - barProgress * 100) + "%) translateZ(0)";
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

  // Product image(s) riding the x-ray hand (inside revealXrayGroup, so
  // each reveals in lockstep with the wipe above) — built once
  // data/products.json loads, from the same fetch the grid below already
  // makes. Not a single fixed element: any number of products can have
  // "onHand.visible": true at once, so this creates one <img
  // class="reveal__ring"> per visible product rather than assuming
  // there's only ever one. Each one's position/size/rotation comes from
  // that SAME product's own onHand.x/y/scale/rotation (a % of the hand
  // image's own width/height, and degrees) — set as inline custom
  // properties on that specific <img>, not shared globally, so multiple
  // rings on screen at once don't fight over one set of values the way
  // css/style.css's --ring-x/--ring-y/--ring-size/--ring-rotation
  // (fallback-only now, see their own comment) would if applied to all
  // of them at once.
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
    // material logic lives in exactly one place. It can return null if
    // the browser couldn't grant a WebGL context (see its own comment) —
    // falls through to the same gridIcon branch a product with no
    // "model" field at all uses, rather than leaving the card blank.
    var gridIcon = product.icons && product.icons[product.metal];
    var modelHandle = product.model ? window.EmjiveModelViewer(product, product.metal) : null;
    if (modelHandle) {
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
        updateHeroRings(data.products || []);
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
