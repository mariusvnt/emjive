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
      var totalScroll = rect.height - window.innerHeight;
      var scrolled = totalScroll > 0 ? Math.min(totalScroll, Math.max(0, -rect.top)) : 0;

      // Phase 1: the frontier band lifts up from below the viewport until
      // it's flush with the pin's bottom edge (the normal image's bottom) —
      // this takes exactly one band-height of scrolling. Phase 2 only then
      // starts the x-ray wipe, with the band riding the reveal boundary.
      var liftDistance = Math.min(revealFrontier.getBoundingClientRect().height, totalScroll);
      var wipeDistance = Math.max(totalScroll - liftDistance, 1);

      if (scrolled <= liftDistance) {
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
  // per product via the "shader" field in products.json (defaults to
  // "silver" if omitted or unrecognized).
  var SHADER_PRESETS = {
    silver: { baseColorFactor: [0.6, 0.62, 0.64, 1], metallicFactor: 1.0, roughnessFactor: 0.28 },
    gold: { baseColorFactor: [1, 0.73, 0.28, 1], metallicFactor: 1.0, roughnessFactor: 0.12, exposure: "1.15" }
  };

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  /* ---- spray background: two random brushed blobs, stable per product -- */

  var SVG_NS = "http://www.w3.org/2000/svg";
  var SPRAY_SIZE = 200;

  function seededRandom(seedStr) {
    var h = 2166136261;
    for (var i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h += 0x6d2b79f5;
      var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cubicPoint(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    var a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
    };
  }

  function cubicTangent(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    var a = 3 * mt * mt, b = 6 * mt * t, c = 3 * t * t;
    return {
      x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
      y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y)
    };
  }

  // A random cubic bezier flowing roughly top-to-bottom through the box,
  // with control points swung to opposite sides so it S-curves.
  function randomFlowCurve(rand, size) {
    var p0 = { x: size * (0.2 + rand() * 0.6), y: -size * 0.15 };
    var p3 = { x: size * (0.2 + rand() * 0.6), y: size * 1.15 };
    var swing = size * (0.5 + rand() * 0.6);
    var p1 = { x: p0.x + (rand() - 0.5) * swing, y: size * (0.15 + rand() * 0.2) };
    var p2 = { x: p3.x + (rand() - 0.5) * swing, y: size * (0.65 + rand() * 0.2) };
    return [p0, p1, p2, p3];
  }

  // A handful of random "knot" values eased together with smoothstep —
  // an irregular, non-repeating width profile rather than a periodic wave.
  function randomWidthProfile(rand) {
    var knotCount = 5 + Math.floor(rand() * 3);
    var knots = [];
    for (var i = 0; i < knotCount; i++) {
      knots.push(0.08 + rand() * 0.92);
    }
    return function (t) {
      var pos = t * (knotCount - 1);
      var i0 = Math.floor(pos);
      var i1 = Math.min(i0 + 1, knotCount - 1);
      var frac = pos - i0;
      var s = frac * frac * (3 - 2 * frac); // smoothstep easing
      return knots[i0] * (1 - s) + knots[i1] * s;
    };
  }

  // One side (left or right) of a ribbon, rendered as a strip of small
  // quads rather than one flat polygon — each quad gets its own opacity
  // from an independent random profile, so the fade varies along the
  // length instead of being uniform.
  function buildRibbonSide(pts, size, baseWidth, sign, rand, className) {
    var steps = 48;
    var widthProfile = randomWidthProfile(rand);
    var fadeProfile = randomWidthProfile(rand);
    var group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", className);

    var prevCenter = null, prevEdge = null, prevOpacity = 0;

    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var pos = cubicPoint(pts[0], pts[1], pts[2], pts[3], t);
      var tan = cubicTangent(pts[0], pts[1], pts[2], pts[3], t);
      var len = Math.sqrt(tan.x * tan.x + tan.y * tan.y) || 1;
      var nx = -tan.y / len, ny = tan.x / len;

      var taper = Math.sin(t * Math.PI); // fades the very ends toward 0
      var w = baseWidth * taper * widthProfile(t);
      var edge = { x: pos.x + sign * nx * w, y: pos.y + sign * ny * w };
      var opacity = taper * fadeProfile(t);

      if (i > 0) {
        var quad = document.createElementNS(SVG_NS, "polygon");
        var pts4 = [prevCenter, prevEdge, edge, pos];
        quad.setAttribute("points", pts4.map(function (p) {
          return p.x.toFixed(1) + "," + p.y.toFixed(1);
        }).join(" "));
        quad.setAttribute("fill-opacity", ((opacity + prevOpacity) / 2).toFixed(2));
        group.appendChild(quad);
      }

      prevCenter = pos;
      prevEdge = edge;
      prevOpacity = opacity;
    }

    return group;
  }

  function buildSpray(product) {
    var wrap = el("div", "product-card__spray");
    var rand = seededRandom(String(product.id || "") + String(product.name || ""));

    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + SPRAY_SIZE + " " + SPRAY_SIZE);
    svg.setAttribute("class", "product-card__spray-svg");
    svg.setAttribute("preserveAspectRatio", "none");

    var group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("filter", "url(#brush-fade)");

    ["a", "b"].forEach(function (variant) {
      var pts = randomFlowCurve(rand, SPRAY_SIZE);
      var baseWidth = SPRAY_SIZE * (0.16 + rand() * 0.1);
      var colorGroup = document.createElementNS(SVG_NS, "g");
      colorGroup.setAttribute("class", "product-card__spray-ribbon product-card__spray-ribbon--" + variant);
      colorGroup.appendChild(buildRibbonSide(pts, SPRAY_SIZE, baseWidth, 1, rand, "product-card__spray-side"));
      colorGroup.appendChild(buildRibbonSide(pts, SPRAY_SIZE, baseWidth, -1, rand, "product-card__spray-side"));
      group.appendChild(colorGroup);
    });

    svg.appendChild(group);
    wrap.appendChild(svg);
    return wrap;
  }

  function buildCard(product) {
    var card = el("article", "product-card");
    var figure = el("div", "product-card__figure");
    figure.appendChild(buildSpray(product));

    if (product.model) {
      var mv = document.createElement("model-viewer");
      mv.setAttribute("src", product.model);
      if (product.image) mv.setAttribute("poster", product.image);
      mv.setAttribute("alt", product.name || "");
      mv.setAttribute("camera-controls", "");
      mv.setAttribute("disable-zoom", "");
      mv.setAttribute("shadow-intensity", "0");
      // A real studio HDRI instead of model-viewer's flat built-in
      // "neutral" IBL — metals (gold especially) are mostly just
      // reflecting the environment, so this matters more than the
      // material numbers for getting a rich, Blender-like result.
      // Downscaled + converted from the original 8k/300MB EXR source
      // (assets/studio_kontrast_04_8k.exr) to a web-friendly 1024px-wide
      // .hdr — three.js's EXR loader rejected the re-encoded EXR outright,
      // Radiance .hdr worked without issue.
      mv.setAttribute("environment-image", "assets/hdri/studio_kontrast_04_1k.hdr");

      var shader = SHADER_PRESETS[product.shader] || SHADER_PRESETS.silver;
      mv.setAttribute("exposure", shader.exposure || "1");

      // Default view: falls back to model-viewer's own default framing
      // ("0deg 75deg 105%") if the product doesn't specify one.
      var defaultOrbit = product.cameraOrbit || "0deg 75deg 105%";
      var dragDecay = "200";   // snappy while the user is actively rotating
      var returnDecay = "1000"; // slow ease-back once they let go
      mv.setAttribute("camera-orbit", defaultOrbit);
      mv.setAttribute("interpolation-decay", dragDecay);
      if (product.cameraTarget) mv.setAttribute("camera-target", product.cameraTarget);

      mv.addEventListener("load", function () {
        mv.model.materials.forEach(function (material) {
          material.pbrMetallicRoughness.setBaseColorFactor(shader.baseColorFactor);
          material.pbrMetallicRoughness.setMetallicFactor(shader.metallicFactor);
          material.pbrMetallicRoughness.setRoughnessFactor(shader.roughnessFactor);
        });
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

      figure.appendChild(mv);
    } else if (product.image) {
      var img = el("img");
      img.src = product.image;
      img.alt = product.name || "";
      img.loading = "lazy";
      figure.appendChild(img);
    }

    if (product.name) {
      figure.appendChild(el("span", "product-card__label", product.name));
    }

    card.appendChild(figure);
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
      .then(renderProducts)
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
