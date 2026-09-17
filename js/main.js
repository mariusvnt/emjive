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
    // Which pointer this gesture belongs to, or null between gestures.
    // Without it, a pointerup that never had a matching pointerdown on
    // this element — a drag begun on the page background and released
    // over a card, or a second finger lifting during a two-finger scroll
    // — was measured against whatever startX/startY happened to be left
    // over (0,0 on a fresh page), which reads as a zero-distance "click"
    // and navigates to a product the visitor never tapped.
    var activePointerId = null;

    mv.addEventListener("pointerdown", function (e) {
      activePointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
    });

    mv.addEventListener("pointercancel", function (e) {
      if (e.pointerId === activePointerId) activePointerId = null;
    });

    mv.addEventListener("pointerup", function (e) {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) {
        window.location.href = href;
      }
    });
  }

  // Building a live three.js viewer for every card — one WebGLRenderer, one
  // full glTF fetch/decode, one from-scratch HDRI PMREM build, each — used
  // to happen unconditionally and instantly for every product in the
  // series the moment the grid rendered. That was fine with a handful of
  // small models; it stopped being fine once the catalog grew to several
  // tens-of-MB models each (eight of them for Bones alone, over 100MB of
  // glTF data combined) — doing all eight at once on page load overloads
  // real devices' GPU/memory badly enough to crash the tab outright (a
  // repeated "Aw, Snap!"), not just run slowly. Built lazily instead — only
  // once a card scrolls near the viewport — and disposed again once it's
  // scrolled well clear (see three-viewer.js's dispose(), strengthened
  // alongside this to actually free the model/environment GPU memory, not
  // just the renderer shell), so at most a handful of viewers/models exist
  // at once regardless of how large the catalog grows. The two margins are
  // deliberately far apart (build early, dispose late) so a card doesn't
  // thrash build/dispose right at one boundary during ordinary scrolling.
  var LAZY_BUILD_MARGIN = "150px 0px 150px 0px";
  var LAZY_DISPOSE_MARGIN = "300px 0px 300px 0px";
  var supportsLazyViewers = "IntersectionObserver" in window;

  // Lazy building alone bounds how many viewers EXIST at once; it does
  // nothing about how many start loading at once. A brisk scroll through
  // the grid crosses every card's build margin within a second or two, so
  // every model's fetch+decode used to be kicked off nearly simultaneously
  // — several tens of MB of glTF in flight together, each one's decode
  // landing on the main thread whenever it happens to finish. That's both
  // the slowest possible path to seeing ANY single model (bandwidth split
  // N ways, so they all finish late together instead of one finishing
  // early) and the worst possible memory profile on a phone. Two at a time
  // keeps the pipe busy while letting cards resolve one after another, in
  // the order they were scrolled past.
  var MAX_CONCURRENT_MODEL_LOADS = 2;
  var activeModelLoads = 0;
  var loadQueue = [];

  // Crossfade duration for the icon -> live model swap, in ms. Mirrored in
  // the inline transition set on the viewer element below; kept here as a
  // number since the icon's own removal has to be timed off it.
  var MODEL_FADE_MS = 400;

  // Pops the next still-wanted card off the queue and starts it. Entries
  // whose card scrolled back out while they waited are dropped rather than
  // loaded — the whole point of queueing is that by the time a slot frees
  // up, some of what's waiting is no longer worth fetching.
  function pumpLoadQueue() {
    while (activeModelLoads < MAX_CONCURRENT_MODEL_LOADS && loadQueue.length) {
      var entry = loadQueue.shift();
      entry.queued = false;
      if (entry.wantsViewer && !entry.modelHandle) startViewerLoad(entry);
    }
  }

  // No metal picker on the homepage grid — always the product's own default
  // metal (product["default-metal"]). window.EmjiveModelViewer is exposed
  // by js/three-viewer.js — reused here so the viewer construction/material
  // logic lives in exactly one place. It can return null if the browser
  // couldn't grant a WebGL context (see its own comment) — the icon (never
  // removed from the card, only hidden) is left showing in that case,
  // same as a product with no "assets.model" field at all.
  function startViewerLoad(entry) {
    activeModelLoads++;
    var settled = false;
    // Whether it loaded or failed, the slot has to come back — and exactly
    // once, however the viewer resolves (including a dispose that beats
    // the load to the finish line).
    function releaseSlot() {
      if (settled) return;
      settled = true;
      activeModelLoads--;
      pumpLoadQueue();
    }

    var handle = window.EmjiveModelViewer(
      entry.product,
      entry.product["default-metal"],
      {
        hdri: window.EmjiveSeries.hdriPath(activeSlug),
        // The card's own icon is already on screen and already framed
        // for this product, so the viewer's built-in poster would just be
        // a second, differently-cropped copy of the same ring fading over
        // the first. See options.poster in js/three-viewer.js.
        poster: false,
        // Several of these can be alive at once, and iOS Safari's canvas
        // budget is a page-wide total — see maxPixelRatio's comment in
        // js/three-viewer.js. product.html's single carousel viewer keeps
        // the full 2x.
        maxPixelRatio: 1.5,
        onReady: function () {
          releaseSlot();
          revealViewer(entry);
        },
        // Fires for an initial load/HDRI failure (the icon is still showing
        // then — never faded out — so teardownViewer's own iconEl.hidden =
        // false is a no-op) OR, since three-viewer.js also treats a WebGL
        // context loss as a failure, for a model that HAD already loaded
        // and was on screen: iOS Safari can silently reclaim a GPU context
        // under memory pressure at any time, not just during load. Either
        // way this puts the icon back and drops the dead viewer, rather
        // than leaving a blank canvas with nothing telling the visitor
        // anything's wrong.
        onError: function () {
          releaseSlot();
          teardownViewer(entry);
        }
      }
    );
    if (!handle) {
      releaseSlot();
      return;
    }
    entry.modelHandle = handle;
    wireModelClickNavigation(handle.el, entry.href);
    // Mounted transparent: the icon stays visible underneath for the whole
    // load, and the model dissolves in over it once it's actually ready.
    // Previously the icon was hidden the instant the viewer was CREATED,
    // which meant the card went icon -> blank/poster -> model, with the
    // first swap happening long before anything had finished loading.
    handle.el.style.opacity = "0";
    handle.el.style.transition = "opacity " + MODEL_FADE_MS + "ms ease";
    entry.figure.appendChild(handle.el);
  }

  function revealViewer(entry) {
    if (!entry.modelHandle) return;
    entry.modelHandle.el.style.opacity = "1";
    // The icon is only taken out of the layout once the model has fully
    // faded in over it — hiding it mid-crossfade would show the page
    // background through the model's transparent areas for the rest of
    // the fade. Re-checks entry.modelHandle because the card can be
    // disposed during those 400ms, which puts the icon back.
    entry.fadeTimer = setTimeout(function () {
      entry.fadeTimer = null;
      if (entry.modelHandle && entry.iconEl) entry.iconEl.hidden = true;
    }, MODEL_FADE_MS);
  }

  function buildViewerFor(entry) {
    entry.wantsViewer = true;
    if (entry.modelHandle || entry.queued) return;
    if (!entry.product.assets || !entry.product.assets.model) return;
    if (activeModelLoads >= MAX_CONCURRENT_MODEL_LOADS) {
      entry.queued = true;
      loadQueue.push(entry);
      return;
    }
    startViewerLoad(entry);
  }

  // Disposes an in-progress or already-live viewer and puts the icon back —
  // shared by disposeViewerFor (card scrolled out of range) and
  // startViewerLoad's onError above (the viewer itself failed, whether
  // during the initial load or well after, via a later WebGL context
  // loss). Deliberately doesn't touch entry.wantsViewer/entry.queued —
  // callers that mean "give up on this card for now" (disposeViewerFor)
  // set those themselves; the onError path leaves wantsViewer true so a
  // later rebuild is attempted the next time this card's build margin
  // re-fires, same as a WebGL-context-budget rejection already does.
  function teardownViewer(entry) {
    if (entry.fadeTimer) {
      clearTimeout(entry.fadeTimer);
      entry.fadeTimer = null;
    }
    if (!entry.modelHandle) return;
    entry.modelHandle.dispose();
    entry.figure.removeChild(entry.modelHandle.el);
    entry.modelHandle = null;
    if (entry.iconEl) entry.iconEl.hidden = false;
  }

  function disposeViewerFor(entry) {
    entry.wantsViewer = false;
    // Still waiting its turn: drop the intent now so pumpLoadQueue skips
    // it, instead of letting a card that's long since scrolled past still
    // claim a slot and pull its model down.
    if (entry.queued) {
      var i = loadQueue.indexOf(entry);
      if (i !== -1) loadQueue.splice(i, 1);
      entry.queued = false;
    }
    teardownViewer(entry);
  }

  // Two observers, not one, for the hysteresis noted above — figure.cardEntry
  // (set in renderProducts) is how each observed element finds its way back
  // to the per-card state buildViewerFor/disposeViewerFor need.
  var buildObserver = supportsLazyViewers && new IntersectionObserver(function (observerEntries) {
    observerEntries.forEach(function (observerEntry) {
      if (observerEntry.isIntersecting) buildViewerFor(observerEntry.target.cardEntry);
    });
  }, { rootMargin: LAZY_BUILD_MARGIN });

  var disposeObserver = supportsLazyViewers && new IntersectionObserver(function (observerEntries) {
    observerEntries.forEach(function (observerEntry) {
      if (!observerEntry.isIntersecting) disposeViewerFor(observerEntry.target.cardEntry);
    });
  }, { rootMargin: LAZY_DISPOSE_MARGIN });

  function buildCard(product) {
    var card = el("article", "product-card");
    var figure = el("div", "product-card__figure");
    var href = window.EmjiveSeries.productHref(product, activeSlug);

    // The card's initial content, standing in for the 3D viewer until one
    // is lazily built and its model has actually loaded (buildViewerFor /
    // revealViewer above).
    //
    // WHICH image matters, and the two are not interchangeable. "icons" is
    // re-framed art: scripts/auto-render.js trims it to its own alpha
    // bounding box and rescales that to a fixed 80% of the frame
    // (ICON_CONTENT_FRACTION), deliberately, so thumbnails all read at a
    // consistent size next to each other. That normalization is exactly
    // what makes it WRONG here — a thin ring's silhouette is far smaller
    // than the bounding SPHERE frameCamera() fits to the viewport, so a
    // trimmed-and-rescaled icon draws the ring visibly larger than the
    // live camera ever will, and the handover reads as the model snapping
    // smaller the instant it appears.
    //
    // "fallback-img" is the same capture saved WITHOUT that treatment —
    // the model's own default pose at its own default framing, which is
    // the one thing that lines up with the live canvas pixel-for-pixel.
    // It only exists for products that have a model to render, so the icon
    // stays the fallback for everything else.
    var assets = product.assets || {};
    var defaultMetal = product["default-metal"];
    var placeholderSrc =
      (assets.model && assets["fallback-img"] && assets["fallback-img"][defaultMetal]) ||
      (assets.icons && assets.icons[defaultMetal]);
    var iconEl = null;
    if (placeholderSrc) {
      iconEl = el("img");
      iconEl.src = placeholderSrc;
      iconEl.alt = product.name || "";
      iconEl.loading = "lazy";
      // Keeps the decode off the main thread. These are 512px WebPs and a
      // grid can hold a dozen, so the synchronous default would land a
      // burst of decodes on whichever frame the images happen to arrive in
      // — exactly while the viewer for the card being scrolled toward is
      // trying to parse its own model.
      iconEl.decoding = "async";
      figure.appendChild(iconEl);
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

    return { el: card, figure: figure, iconEl: iconEl, href: href };
  }

  // Every card, built ONCE, paired with the product it came from. Filtering
  // toggles `hidden` on these rather than re-rendering the grid: a rebuild
  // would destroy and recreate every already-lazily-built three.js
  // WebGLRenderer on each toggle. Past the browser's per-page context
  // budget buildViewerFor() leaves entry.modelHandle null and the card
  // just keeps showing its icon — same graceful-degradation contract as
  // before, just discovered lazily now instead of all at once on load.
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
      var built = buildCard(product);
      var entry = {
        product: product,
        el: built.el,
        figure: built.figure,
        iconEl: built.iconEl,
        href: built.href,
        modelHandle: null,
        // Set/cleared by the two observers; read by pumpLoadQueue to skip
        // anything that stopped being worth loading while it queued.
        wantsViewer: false,
        queued: false,
        fadeTimer: null
      };
      cards.push(entry);
      grid.appendChild(built.el);
      if (supportsLazyViewers) {
        built.figure.cardEntry = entry;
        buildObserver.observe(built.figure);
        disposeObserver.observe(built.figure);
      } else {
        // No IntersectionObserver (very old browser) — fall back to the
        // previous behavior of building every viewer immediately/eagerly
        // rather than leaving every card icon-only forever.
        buildViewerFor(entry);
      }
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
