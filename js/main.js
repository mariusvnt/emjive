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
  var siteHeader = document.querySelector(".site-header");
  var siteHeaderRow = document.querySelector(".site-header__row");

  // Registered with window.EmjiveMenus (js/series.js) so a click away from
  // the header closes it — root spans the whole header (toggle included),
  // not just the menu panel, so clicking the toggle itself is never
  // mistaken for "away" by that shared listener.
  var headerMenuPanel = { root: siteHeader, close: function () { setHeaderMenuOpen(false); } };

  function setHeaderMenuOpen(isOpen) {
    menuToggle.classList.toggle("is-open", isOpen);
    siteHeaderMenu.classList.toggle("is-open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    if (window.EmjiveMenus) {
      if (isOpen) window.EmjiveMenus.opened(headerMenuPanel);
      else window.EmjiveMenus.closed(headerMenuPanel);
    }
  }

  // Only this page can filter in place; everywhere else a category click is
  // a real navigation back to the grid.
  var filtersAreInPlace = !!document.getElementById("productGrid");

  if (menuToggle && siteHeaderMenu) {
    menuToggle.addEventListener("click", function () {
      setHeaderMenuOpen(!menuToggle.classList.contains("is-open"));
    });

    // The empty space in the header row (outside the brand logo and the
    // toggle button itself, both of which already have their own handlers
    // — the logo navigates home, the toggle would otherwise double-fire)
    // toggles the menu too, same as clicking the +/- icon.
    if (siteHeaderRow) {
      siteHeaderRow.addEventListener("click", function (e) {
        if (e.target.closest(".site-header__brand") || e.target.closest(".menu-toggle")) return;
        setHeaderMenuOpen(!menuToggle.classList.contains("is-open"));
      });
    }

    // Delegated rather than bound per link: the category buttons are
    // rendered from data after this runs, so a per-link listener would
    // never reach them.
    siteHeaderMenu.addEventListener("click", function (e) {
      var link = e.target.closest("a");
      if (!link || !siteHeaderMenu.contains(link)) return;

      if (link.classList.contains("is-cat")) {
        // On the grid page the menu deliberately stays OPEN — multi-select
        // is unusable if it closes after every toggle. Elsewhere, fall
        // through to the link's own href and let it navigate.
        if (!filtersAreInPlace) return;
        e.preventDefault();
        toggleCategory(link.dataset.cat);
        return;
      }

      setHeaderMenuOpen(false);
    });
  }

  /* ---- header category filter -------------------------------------------- */

  // Categories are per-series: each series declares its own subset of the
  // global vocabulary, so this row is rendered from the ACTIVE series
  // (?series=, else the featured one) rather than a fixed list. That's also
  // the series a click will land on, so the buttons never advertise a
  // category the destination can't show.
  var filterOptions = document.getElementById("headerFilterOptions");
  var filterRow = document.getElementById("siteHeaderFilter");
  var activeCats = [];

  function parseCatsFromQuery(valid) {
    var raw = new URLSearchParams(window.location.search).get("cat");
    if (!raw) return [];
    // Unknown values are dropped rather than left to match nothing, so a
    // typo — or a category belonging to some other series — shows
    // everything instead of an empty grid.
    return raw.split(",")
      .map(function (c) { return c.trim(); })
      .filter(function (c) { return c && valid.indexOf(c) !== -1; });
  }

  function buildFilterHref(cat) {
    // Built off the real index URL so ?series= is preserved and the
    // "/emjive/" base is never a concern.
    var url = new URL("index.html", window.location.href);
    var series = window.EmjiveSeries.slug;
    if (series && !window.EmjiveSeries.isFeatured(series)) {
      url.searchParams.set("series", series);
    }
    url.searchParams.set("cat", cat);
    return url.pathname + url.search + "#products";
  }

  function renderHeaderFilter() {
    if (!filterOptions) return;
    filterOptions.innerHTML = "";
    var cats = window.EmjiveSeries.categories();
    // One category (or zero) means there's nothing to filter — toggling
    // the sole button on/off can never change what the grid shows.
    if (filterRow) filterRow.hidden = cats.length <= 1;
    cats.forEach(function (cat) {
      // Real <a href>, not <button>, on every page: that keeps middle-click
      // and open-in-new-tab working, with the in-place toggle layered on
      // top via preventDefault() where the grid exists.
      var link = document.createElement("a");
      link.className = "is-cat";
      link.dataset.cat = cat;
      link.textContent = "." + cat;
      link.href = buildFilterHref(cat);
      filterOptions.appendChild(link);
    });
    syncFilterButtons();
  }

  function syncFilterButtons() {
    if (!filterOptions) return;
    filterOptions.querySelectorAll("a.is-cat").forEach(function (link) {
      var on = activeCats.indexOf(link.dataset.cat) !== -1;
      link.classList.toggle("is-active", on);
      if (on) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
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

  // Every card, built ONCE, paired with the product it came from. Filtering
  // toggles `hidden` on these rather than re-rendering the grid: a rebuild
  // would destroy and recreate every three.js WebGLRenderer on each toggle,
  // and nothing on the live site disposes contexts. Past the browser's
  // per-page context budget buildThreeViewer() returns null, and the grid
  // degrades to static icons — permanently, for that page.
  var cards = [];
  var emptyMsg = null;

  function renderProducts(products) {
    grid.innerHTML = "";
    cards = [];
    if (!products.length) {
      grid.appendChild(el("p", "product-grid__loading",
        "No products yet — add some to this series' products.json (see data/series.json)"));
      return;
    }
    products.forEach(function (product) {
      var card = buildCard(product);
      cards.push({ product: product, el: card });
      grid.appendChild(card);
    });
  }

  function applyFilter() {
    var counts = {};
    cards.forEach(function (entry) {
      var cat = entry.product.category;
      counts[cat] = (counts[cat] || 0) + 1;
      entry.el.hidden = activeCats.length > 0 && activeCats.indexOf(cat) === -1;
    });

    var visible = cards.filter(function (entry) { return !entry.el.hidden; }).length;

    // Reuses .product-grid__loading as the empty state — it already spans
    // the full grid row, centered and muted, so no new CSS is needed.
    if (!visible && cards.length) {
      if (!emptyMsg) {
        emptyMsg = el("p", "product-grid__loading");
        var showAll = el("button", "btn", "Show all");
        showAll.type = "button";
        showAll.addEventListener("click", function () { setCategories([]); });
        emptyMsg.textContent = "Nothing in " + activeCats.map(function (c) { return "." + c; }).join(" or ") +
          " in this series yet. ";
        emptyMsg.appendChild(showAll);
        grid.appendChild(emptyMsg);
      } else {
        emptyMsg.firstChild.nodeValue = "Nothing in " +
          activeCats.map(function (c) { return "." + c; }).join(" or ") + " in this series yet. ";
        emptyMsg.hidden = false;
      }
    } else if (emptyMsg) {
      emptyMsg.hidden = true;
    }

    // A styling hook only — nothing renders differently for these yet, but
    // it lets a zero-product category be dimmed later without touching JS.
    if (filterOptions) {
      filterOptions.querySelectorAll("a.is-cat").forEach(function (link) {
        var n = counts[link.dataset.cat] || 0;
        link.dataset.count = String(n);
        link.classList.toggle("is-empty", n === 0);
      });
    }

    syncFilterButtons();
  }

  function syncFilterUrl() {
    var url = new URL(window.location.href);
    if (activeCats.length) url.searchParams.set("cat", activeCats.join(","));
    else url.searchParams.delete("cat");
    // new URL(location.href) keeps ?series= and the "/emjive/" base intact
    // for free, and replaceState avoids stacking a history entry per toggle.
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  function setCategories(next) {
    activeCats = next;
    applyFilter();
    syncFilterUrl();
  }

  function toggleCategory(cat) {
    if (!cat) return;
    var i = activeCats.indexOf(cat);
    setCategories(i === -1
      ? activeCats.concat([cat])
      : activeCats.filter(function (c) { return c !== cat; }));
  }

  // The header's filter row renders on EVERY page, including the ones that
  // load no product data at all — which is exactly why the category list
  // lives in data/series.json's index rather than inside a products file.
  window.EmjiveSeries.ready.then(function () {
    activeCats = parseCatsFromQuery(window.EmjiveSeries.categories());
    renderHeaderFilter();
  });

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
        // Cards exist now, so a ?cat= arrived at from another page (or a
        // shared link) can finally be applied.
        applyFilter();
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
