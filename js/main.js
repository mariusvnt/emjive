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
  var filterLabel = filterRow && filterRow.querySelector(".site-header__filter-label");
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

    if (!filtersAreInPlace) {
      // Every page but the grid: the row becomes a plain "back to the
      // gallery" link instead of a filter — category count is irrelevant
      // here, so this is unconditional. Never dotted — only category tags
      // carry a selection state (see css/style.css).
      if (filterRow) filterRow.hidden = false;
      if (filterLabel) filterLabel.hidden = true;
      var galleryLink = document.createElement("a");
      galleryLink.className = "is-info";
      galleryLink.textContent = "Gallery";
      galleryLink.href = window.EmjiveSeries.mainHref(window.EmjiveSeries.slug) + "#products";
      filterOptions.appendChild(galleryLink);
      return;
    }

    var cats = window.EmjiveSeries.categories();
    // Zero categories: nothing to show at all. Exactly one: nothing to
    // actually filter either — toggling the sole tag can never change what
    // the grid shows — so "Filter gallery by" is dropped and the bare tag
    // renders permanently dotted and inert instead of interactive.
    if (filterRow) filterRow.hidden = cats.length === 0;
    if (filterLabel) filterLabel.hidden = cats.length <= 1;

    if (cats.length === 1) {
      // No href, no click listener: an <a> with no href is natively
      // unclickable/unfocusable, so that alone is enough to make this
      // inert — no separate markup shape needed, and it still matches
      // every .site-header__nav a.is-cat rule in css/style.css.
      var soleTag = document.createElement("a");
      soleTag.className = "is-cat is-active";
      soleTag.textContent = cats[0];
      filterOptions.appendChild(soleTag);
      return;
    }

    cats.forEach(function (cat) {
      // Real <a href>, not <button>, on every page: that keeps middle-click
      // and open-in-new-tab working, with the in-place toggle layered on
      // top via preventDefault() where the grid exists. No "." prefix —
      // the selection dot (css/style.css) already carries that signal, a
      // second one in the text itself would be redundant.
      var link = document.createElement("a");
      link.className = "is-cat";
      link.dataset.cat = cat;
      link.textContent = cat;
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

  function buildCard(product) {
    var card = el("article", "product-card");
    var figure = el("div", "product-card__figure");
    var href = window.EmjiveSeries.productHref(product, activeSlug);

    // A static icon, never a 3D viewer: this page now builds exactly ONE
    // WebGLRenderer — the magnified viewer inside the lens
    // (js/lens-artefact.js), which renders whichever product is currently
    // focused. That's what makes the "seen through the glass" design work,
    // and it also retires this grid's oldest scaling hazard: a viewer per
    // card used to exhaust the browser's per-page WebGL context budget,
    // after which buildThreeViewer() returned null and the rest of the grid
    // degraded to static icons permanently.
    // fallback-img, NOT icons — the same choice, for the same reason, that
    // js/three-viewer.js makes for its poster: icons is cropped/re-centered
    // for use as a flat thumbnail elsewhere and does not match the model's
    // real default framing, whereas fallback-img IS that framing captured
    // as-is. Here that's what makes the magnification honest: the lens
    // re-renders the same model from 1/1.25 the distance into a box the
    // same size as this one, so the glass shows it exactly 1.25x bigger.
    // With icons the two would differ by an arbitrary crop as well, and the
    // lens would read as a reframe rather than a magnification.
    // Always the product's own default metal — there's no metal picker here.
    var metal = product["default-metal"];
    var assets = product.assets || {};
    var gridIcon = (assets["fallback-img"] && assets["fallback-img"][metal]) ||
      (assets.icons && assets.icons[metal]);
    if (gridIcon) {
      var img = el("img");
      img.src = gridIcon;
      img.alt = product.name || "";
      img.loading = "lazy";
      figure.appendChild(img);
    }

    card.appendChild(figure);

    // Kept in the DOM but visually hidden (see css/style.css). The black
    // bar beside the lens is a painted, aria-hidden duplicate that only
    // ever shows the ONE focused product, so this stays the real crawlable,
    // keyboard-reachable link for every product in the grid — and it
    // un-hides itself on :focus-visible, so tabbing through never lands on
    // something invisible.
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
  // toggles `hidden` on these rather than re-rendering the grid. That used
  // to be load-bearing (a rebuild destroyed and recreated a WebGLRenderer
  // per card, and nothing disposes contexts on the live site); now that
  // cards are static icons it's merely the cheaper path — but the pairing
  // itself has a new job, as the payload of "emjive:grid-changed" below.
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

    // The one funnel every card-visibility change passes through — the
    // initial render calls this too — so it's the only place that has to
    // announce "the set of visible cards changed". js/product-focus.js
    // listens, re-derives which card is focused, and republishes that to
    // js/lens-artefact.js. `entries` is handed over directly rather than
    // re-queried from the DOM because it already pairs each card element
    // with the product object the lens viewer needs to build from.
    // Published as state as well as an event, and that is NOT redundant:
    // this runs inside loadProducts()'s .then(), and on a warm cache that
    // promise can resolve in the gap between two deferred scripts — so the
    // event can fire before js/product-focus.js has even executed, let alone
    // subscribed. It would then never learn the grid exists. A late
    // subscriber reads this instead; the event stays for subsequent changes.
    window.EmjiveGrid = { entries: cards };
    window.dispatchEvent(new CustomEvent("emjive:grid-changed", {
      detail: { entries: cards }
    }));
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
