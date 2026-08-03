/* ==========================================================================
   J&MV — site behaviour
   Renders the active series' products into the grid, plus small UI
   interactions. Loads on every page.

   Owns no hero logic at all: the homepage hero is per-series now and lives
   in that series' own bundle (series/<slug>/hero.js), injected by
   js/series.js — see dev-guidelines/client-scripts.md.
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

  /* ---- product grid ------------------------------------------------------ */

  var grid = document.getElementById("productGrid");
  // Which series the grid is showing — set before any card is built, and
  // carried into every product link so a card in a past series opens that
  // series' product page rather than the featured one's.
  var activeSlug = null;

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
    var href = window.EmjiveSeries.productHref(product, activeSlug);

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
      grid.appendChild(el("p", "product-grid__loading",
        "No products yet — add some to this series' products.json (see data/series.json)"));
      return;
    }
    products.forEach(function (product) {
      grid.appendChild(buildCard(product));
    });
  }

  // The catalog is per-series now: js/series.js owns resolving which series
  // this page is showing (?series=, else data/series.json's "featured") and
  // fetching its products, so nothing here talks to a JSON path directly.
  if (grid) {
    window.EmjiveSeries.ready
      .then(function (ctx) {
        activeSlug = ctx.slug;
        return window.EmjiveSeries.loadProducts(ctx.slug);
      })
      .then(function (products) {
        renderProducts(products);
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
