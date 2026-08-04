/* em·ji·ve — series resolution.
 *
 * Loaded BLOCKING from <head> on every page (no defer, no type="module"),
 * for three reasons:
 *   1. It must define window.EmjiveSeries before js/main.js runs, and
 *      launch-order.html loads main.js as a plain synchronous body script —
 *      a deferred series.js would run after it.
 *   2. It starts the data/series.json fetch at head-parse time, which is
 *      the whole anti-flash story for the injected hero (see loadHero).
 *   3. It's small; the parse block is negligible, and the preload scanner
 *      fetches it in parallel with the stylesheet anyway.
 *
 * This does NOT disturb the defer contract documented in
 * dev-guidelines/pages.md: a blocking <head> script runs before the whole
 * deferred queue, so three-viewer.js (module, first in document order)
 * still executes before main.js/product.js (both defer) within it. */
(function () {
  "use strict";

  var INDEX_PATH = "data/series.json";

  // Paths inside data/*.json are repo-root-relative with no leading slash,
  // which resolves correctly only because every HTML page sits at the repo
  // root. See dev-guidelines/data.md.
  var index = null;
  var activeSlug = null;
  var activeSeries = null;

  // Memoized per slug: main.js wants the grid's products and the hero
  // handoff wants the same array — one request, two consumers.
  var productCache = {};
  var manifestCache = {};

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function resolveSlug(data) {
    var wanted = queryParam("series");
    if (wanted) {
      for (var i = 0; i < data.series.length; i++) {
        if (data.series[i].slug === wanted) return wanted;
      }
      console.warn("Unknown series: " + wanted);
    }
    return data.featured;
  }

  function get(slug) {
    if (!index || !slug) return null;
    for (var i = 0; i < index.series.length; i++) {
      if (index.series[i].slug === slug) return index.series[i];
    }
    return null;
  }

  function fetchJson(path) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error("Could not load " + path);
      return res.json();
    });
  }

  function loadProducts(slug) {
    var entry = get(slug);
    if (!entry) return Promise.reject(new Error("Unknown series: " + slug));
    if (!productCache[slug]) {
      productCache[slug] = fetchJson(entry.products).then(function (data) {
        return data.products || [];
      });
    }
    return productCache[slug];
  }

  function loadManifest(slug) {
    var entry = get(slug);
    if (!entry) return Promise.reject(new Error("Unknown series: " + slug));
    if (!manifestCache[slug]) manifestCache[slug] = fetchJson(entry.manifest);
    return manifestCache[slug];
  }

  // Href helpers deliberately omit ?series= for the featured series, so the
  // common case keeps clean, shareable URLs (product.html?id=01) and links
  // bookmarked before this refactor keep resolving unchanged.
  function isFeatured(slug) {
    return !!index && slug === index.featured;
  }

  function seriesParam(slug, leading) {
    if (!slug || isFeatured(slug)) return "";
    return (leading || "?") + "series=" + encodeURIComponent(slug);
  }

  function mainHref(slug) {
    return "index.html" + seriesParam(slug);
  }

  function manifestHref(slug) {
    return "series.html?series=" + encodeURIComponent(slug);
  }

  function productHref(product, slug) {
    var s = seriesParam(slug);
    return "product.html" + (s ? s + "&" : "?") + "id=" + encodeURIComponent(product.id);
  }

  /* ---------------------------------------------------------------------
   * Hero <-> chrome scroll bridge.
   *
   * A plain function registry rather than a CustomEvent: this fires once
   * per animation frame while scrolling, and a registry costs no
   * allocation per publish. The hero bundle owns all the geometry and
   * publishes ONE number; js/selection-bar.js consumes it without ever
   * learning which page it's on (it subscribes unconditionally — on pages
   * with no hero, nothing ever publishes, so nothing ever happens).
   * ------------------------------------------------------------------- */
  var heroScrollSubscribers = [];

  window.EmjiveHero = {
    onScroll: function (fn) {
      if (typeof fn === "function") heroScrollSubscribers.push(fn);
    },
    publishScroll: function (pastTriggerPx, hasScrollRange) {
      for (var i = 0; i < heroScrollSubscribers.length; i++) {
        heroScrollSubscribers[i](pastTriggerPx, hasScrollRange);
      }
    }
  };

  /* ---------------------------------------------------------------------
   * Click-away coordination for independently-opened chrome panels — the
   * header menu (js/main.js) and the selection-bar drawer (js/selection-
   * bar.js). Neither file knows about the other, so a plain outside-click
   * listener in either one would either fight the other's own toggle or
   * close both panels on a single click. Instead each panel registers a
   * `root` (spanning both its trigger and its content, so clicking the
   * trigger is never mistaken for "away") and reports its own open/close
   * transitions here. A click landing outside every currently-open
   * panel's root closes only the most-recently-opened one — so if both
   * happen to be open at once, a second outside click is needed to close
   * the other.
   * ------------------------------------------------------------------- */
  var openPanels = []; // oldest-opened first

  window.EmjiveMenus = {
    opened: function (panel) {
      var i = openPanels.indexOf(panel);
      if (i !== -1) openPanels.splice(i, 1);
      openPanels.push(panel);
    },
    closed: function (panel) {
      var i = openPanels.indexOf(panel);
      if (i !== -1) openPanels.splice(i, 1);
    }
  };

  document.addEventListener("click", function (e) {
    if (!openPanels.length) return;
    // A click inside any currently-open panel is that panel's own concern
    // (its toggle, an in-place filter click, etc.) — never "away".
    for (var i = 0; i < openPanels.length; i++) {
      if (openPanels[i].root.contains(e.target)) return;
    }
    var top = openPanels[openPanels.length - 1];
    openPanels.pop();
    top.close();
  });

  /* ---------------------------------------------------------------------
   * Hero bundle loading (index.html only — guarded on #seriesHero, the
   * same pattern main.js uses for #productGrid).
   * ------------------------------------------------------------------- */
  function injectPreload(href) {
    var link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = href;
    document.head.appendChild(link);
  }

  function injectStylesheet(href) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function injectScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error("Could not load " + src)); };
      document.head.appendChild(el);
    });
  }

  function loadHero(slot, entry) {
    var hero = entry && entry.hero;
    if (!hero) return Promise.resolve(false);

    // Fired first and separately: the hero's own images are no longer
    // discoverable by the browser's preload scanner at parse time (they
    // live in a fragment now), so this is what keeps them starting on the
    // second round trip rather than the third.
    (hero.preload || []).forEach(injectPreload);

    // Issued before the fragment fetch resolves, so the bundle's CSS is in
    // flight (and CSS blocks render regardless) by the time any hero markup
    // lands — the x-ray layer is never painted unclipped for a frame.
    if (hero.css) injectStylesheet(hero.css);

    // hero.js is side-effect-free at execution time: it only assigns
    // window.EmjiveSeriesHero and waits to be called. That's what lets the
    // script, the stylesheet and the fragment all be in flight at once —
    // two round trips to first hero paint, not three.
    var fragmentPromise = fetch(hero.fragment).then(function (res) {
      if (!res.ok) throw new Error("Could not load " + hero.fragment);
      return res.text();
    });
    var scriptPromise = hero.js ? injectScript(hero.js) : Promise.resolve();

    return Promise.all([fragmentPromise, scriptPromise]).then(function (results) {
      var doc = new DOMParser().parseFromString(results[0], "text/html");

      // One <template data-series-slot="..."> per destination, so a series
      // can supply zero, one or several regions with no change to
      // index.html. <template> content is inert in the parsed document, so
      // its <img>s don't fetch here — they fetch once, on being cloned into
      // the live document below (and resolve against the PAGE's URL, not
      // the fragment's).
      var templates = doc.querySelectorAll("template[data-series-slot]");
      for (var i = 0; i < templates.length; i++) {
        var target = document.getElementById(templates[i].dataset.seriesSlot);
        if (target) target.appendChild(templates[i].content.cloneNode(true));
        else console.warn("No slot #" + templates[i].dataset.seriesSlot + " for the hero fragment");
      }

      if (window.EmjiveSeriesHero && window.EmjiveSeriesHero.init) {
        window.EmjiveSeriesHero.init(slot, { slug: activeSlug, series: entry });
      }
      return true;
    });
  }

  function heroFailed(slot, err) {
    console.error("Hero bundle failed to load: " + (err && err.message ? err.message : err));
    // Without this the .has-series-hero rule keeps the floating selection
    // bar translated off-screen forever, since nothing will ever publish a
    // scroll position to bring it back.
    document.body.classList.remove("has-series-hero");
    if (slot) slot.innerHTML = "";
  }

  /* ------------------------------------------------------------------- */

  var ready = fetchJson(INDEX_PATH).then(function (data) {
    index = data;
    activeSlug = resolveSlug(data);
    activeSeries = get(activeSlug);

    window.EmjiveSeries.index = index;
    window.EmjiveSeries.metals = index.metals || [];
    window.EmjiveSeries.slug = activeSlug;
    window.EmjiveSeries.series = activeSeries;

    var slot = document.getElementById("seriesHero");
    if (slot && activeSeries) {
      loadHero(slot, activeSeries)
        .then(function (loaded) {
          if (!loaded) return;
          return loadProducts(activeSlug).then(function (products) {
            if (window.EmjiveSeriesHero && window.EmjiveSeriesHero.onProducts) {
              window.EmjiveSeriesHero.onProducts(products);
            }
          });
        })
        .catch(function (err) { heroFailed(slot, err); });
    }

    return { index: index, slug: activeSlug, series: activeSeries };
  });

  window.EmjiveSeries = {
    ready: ready,

    index: null,
    metals: [],
    slug: null,
    series: null,

    // The ACTIVE series' own subset of the global vocabulary, in the order
    // it declared them — this is what the header's filter row renders.
    categories: function () {
      return (activeSeries && activeSeries.categories) || [];
    },

    // Sizing is a property of the category itself, declared once in the
    // global vocabulary — so this resolves identically whichever series a
    // product turned out to live in.
    categoryInfo: function (id) {
      var all = (index && index.categories) || {};
      return all[id] || { sizes: [], unit: "" };
    },

    all: function () { return (index && index.series) || []; },
    get: get,
    featuredSlug: function () { return index && index.featured; },
    isFeatured: isFeatured,

    loadProducts: loadProducts,
    loadManifest: loadManifest,

    mainHref: mainHref,
    manifestHref: manifestHref,
    productHref: productHref,

    // The raw ?series= value, with no featured-series fallback applied.
    // series.html needs this: silently showing the featured series' manifest
    // when the URL asked for a different one is worse than a not-found state.
    requestedSlug: function () { return queryParam("series"); }
  };
})();
