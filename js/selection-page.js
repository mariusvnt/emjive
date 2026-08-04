/* ==========================================================================
   J&MV — order page
   Renders window.EmjiveSelection's contents into launch-order.html as a
   full checkout review: item rows (each with a Modify/Unselect overlay), a
   shipping-option pick, a terms-acceptance toggle, and a fixed "Proceed to
   checkout" bar gated on both of those. Falls back to the static
   .selection-empty block when there's nothing selected.
   ========================================================================== */

(function () {
  "use strict";

  var listEl = document.getElementById("selectionList");
  if (!listEl) return;

  var emptyEl = document.getElementById("selectionEmpty");
  var itemsEl = document.getElementById("selectionItems");

  var shippingOptionsEl = document.getElementById("orderShippingOptions");
  var termsEl = document.getElementById("orderTerms");
  var termsToggleEl = document.getElementById("orderTermsToggle");

  var checkoutBar = document.getElementById("orderCheckoutBar");
  var checkoutTotalEl = document.getElementById("orderCheckoutTotal");
  var checkoutButton = document.getElementById("orderCheckoutButton");

  // Placeholders for now (prices included) — a real carrier/rate list
  // later is just editing these entries, not a restructure of the
  // section around them.
  var SHIPPING_OPTIONS = [
    { id: "standard", name: "Standard shipping", price: 0 },
    { id: "express", name: "Express shipping", price: 15 }
  ];
  var selectedShippingId = SHIPPING_OPTIONS[0].id;
  var termsAccepted = false;

  function updateCheckoutGate() {
    checkoutButton.disabled = !(selectedShippingId && termsAccepted);
  }

  /* ---- item row overlay: one open at a time --------------------------------
     Mouse hover, a tap, or keyboard focus all open the same Modify/Unselect
     overlay over the row (js/selection-page.js has no separate "fast path"
     for any one input type) — mouse/keyboard close it again on leave/blur;
     touch relies on window.EmjiveMenus' click-away coordination (the same
     mechanism the header menu and the floating selection bar's drawer use)
     since there's no touch equivalent of "pointer left the row". Only one
     row's overlay is ever open at a time — opening a new one closes
     whichever was already open. */
  var openRowPanel = null;

  // A removed row's collapse reflows every row below it up the page — if
  // the mouse cursor is just sitting still while that happens, whichever
  // row's box slides underneath it fires that row's own pointerenter
  // exactly as if the user had actually moved onto it, opening an overlay
  // nobody asked for. Set the instant a removal starts, this makes that
  // "phantom" enter (and any other during the reflow) a no-op until a real
  // mouse movement — tracked below — confirms the cursor has actually gone
  // somewhere on its own.
  var suppressHoverUntilMove = false;
  document.addEventListener("pointermove", function (e) {
    if (e.pointerType === "mouse") suppressHoverUntilMove = false;
  });

  function closeOpenRow() {
    if (!openRowPanel) return;
    var panel = openRowPanel;
    openRowPanel = null;
    panel.root.classList.remove("is-open");
    if (window.EmjiveMenus) window.EmjiveMenus.closed(panel);
  }

  function openRowOverlay(li) {
    if (openRowPanel && openRowPanel.root === li) return;
    closeOpenRow();
    li.classList.add("is-open");
    openRowPanel = { root: li, close: closeOpenRow };
    if (window.EmjiveMenus) window.EmjiveMenus.opened(openRowPanel);
  }

  /* ---- undo ----------------------------------------------------------------
     Unselecting a row crossfades its own content into an "Undo" prompt in
     place (css/style.css's .order-item__undo-prompt — same inset: 0
     crossfade recipe .order-item__overlay already uses, so the row never
     resizes) rather than collapsing it and showing a separate shared bar
     elsewhere. Every row tracks its own undo window independently, so
     unselecting several in a row leaves each showing its own prompt —
     deliberately: a row's own removal never causes any *other* row to
     move while it's pending, and each row only ever plays exactly one
     motion of its own (crossfade in place, then — only if its own window
     runs out unused — its final collapse). No shared stack, no shared
     timer, no bar to reuse or reposition.

     rowBindings mirrors itemsEl's children in order, one entry per row:
     { li, item, index, pending, timer, undoBtn }. index is kept live —
     shiftIndices below adjusts every other binding's index whenever one
     row's item is actually removed from or reinserted into storage — so
     each row always knows its own true current position, however many
     other rows are simultaneously mid-undo and regardless of which one
     gets confirmed or undone first. */
  var UNDO_TIMEOUT_MS = 4000;
  // How long the list-to-empty-state crossfade takes once the last row's
  // undo window is truly over — see crossfadeToEmpty().
  var EMPTY_CROSSFADE_MS = 300;
  var rowBindings = [];

  // Called right after binding's own item is actually removed from (delta
  // -1) or reinserted into (delta 1) storage, at fromIndex — updates every
  // *other* binding still tracked so their own .index stays correct
  // without needing a full rebuild. binding itself is excluded: its index
  // already equals fromIndex (that's the position being mutated) and
  // doesn't need adjusting against its own change.
  function shiftIndices(binding, fromIndex, delta) {
    rowBindings.forEach(function (b) {
      if (b === binding) return;
      if (delta < 0 ? b.index > fromIndex : b.index >= fromIndex) {
        b.index += delta;
      }
    });
  }

  // Keeps the checkout total/visibility in sync with storage after every
  // Unselect/Undo — cheap enough to just recompute from scratch rather
  // than tracking a running total, and decoupled from render() since
  // neither action rebuilds the row list any more.
  function updateCheckoutSummary() {
    var items = window.EmjiveSelection.getSelection();
    checkoutBar.hidden = !items.length;
    var total = 0;
    items.forEach(function (item) { total += item.price || 0; });
    checkoutTotalEl.textContent = window.EmjiveSelection.formatPrice(total);
  }

  // Smooths the switch from the list into the "No selected item" empty
  // state — a plain sequential opacity crossfade (list fades out, then
  // the empty state fades in), hand-orchestrated because [hidden] means
  // display:none, which can't itself transition. Sequential, not
  // simultaneous, since the two aren't stacked on top of each other —
  // fading both at once would show list and empty-state content
  // overlapping mid-fade. Called instead of a normal per-row collapse
  // when the very last pending row's own window runs out (confirmRemoval,
  // below) — one motion, not two: that row stays at full size and rides
  // out with the rest of the list as this fades it away, rather than
  // first collapsing itself away on its own and only then having the
  // (now empty) list separately fade into place.
  function crossfadeToEmpty() {
    listEl.style.transition = "opacity " + EMPTY_CROSSFADE_MS + "ms ease";
    listEl.style.opacity = "0";
    var swapped = false;
    function swapToEmpty() {
      if (swapped) return;
      swapped = true;
      listEl.hidden = true;
      listEl.style.transition = "";
      listEl.style.opacity = "";
      checkoutBar.hidden = true;

      emptyEl.hidden = false;
      emptyEl.style.transition = "none";
      emptyEl.style.opacity = "0";
      void emptyEl.offsetWidth;
      // Double rAF: guarantees a real paint of the opacity:0 starting
      // state has happened before the transition to 1 is triggered, so it
      // actually registers instead of coalescing into one paint with no
      // fade.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          emptyEl.style.transition = "opacity " + EMPTY_CROSSFADE_MS + "ms ease";
          emptyEl.style.opacity = "1";
          emptyEl.addEventListener("transitionend", function onEnd(e) {
            if (e.propertyName !== "opacity") return;
            emptyEl.removeEventListener("transitionend", onEnd);
            emptyEl.style.transition = "";
            emptyEl.style.opacity = "";
          });
        });
      });
    }
    listEl.addEventListener("transitionend", function onEnd(e) {
      if (e.propertyName !== "opacity") return;
      listEl.removeEventListener("transitionend", onEnd);
      swapToEmpty();
    });
    // Fallback in case transitionend never fires (e.g. reduced-motion
    // environments that skip the transition outright) — same backstop
    // convention confirmRemoval uses for a normal row collapse.
    setTimeout(swapToEmpty, EMPTY_CROSSFADE_MS + 50);
  }

  // Unselect click: removed from storage immediately (matching Modify and
  // every other mutation here — nothing about this row is "soft" from
  // storage's point of view), but the row itself just crossfades to its
  // own undo prompt in place rather than leaving the DOM. undoBtn.focus()
  // carries keyboard focus along with the crossfade, since the button it
  // was on a moment ago (Unselect, inside .order-item__overlay) is about
  // to become invisible.
  function handleUnselect(binding) {
    window.EmjiveSelection.removeItem(binding.index);
    shiftIndices(binding, binding.index, -1);
    binding.pending = true;
    binding.li.classList.add("is-pending-undo");
    updateCheckoutSummary();
    binding.undoBtn.focus();
    binding.timer = setTimeout(function () {
      binding.timer = null;
      confirmRemoval(binding);
    }, UNDO_TIMEOUT_MS);
  }

  // Undo click: reinserts at binding's own current index (kept accurate by
  // shiftIndices regardless of what's happened to any other row in the
  // meantime) and crossfades straight back — .order-item__content was
  // never rebuilt or removed, only hidden, so there's nothing to reload or
  // reanimate in. Also drops is-open, which handleUnselect deliberately
  // left in place (see its own comment) — while pending, is-pending-undo
  // wins over it in css/style.css regardless, but once pending clears
  // it'd otherwise fall straight back to is-open's own state (the
  // Modify/Unselect overlay) instead of the plain row.
  function handleUndo(binding) {
    if (!binding.pending) return;
    if (binding.timer) {
      clearTimeout(binding.timer);
      binding.timer = null;
    }
    window.EmjiveSelection.insertItem(binding.index, binding.item);
    shiftIndices(binding, binding.index, 1);
    binding.pending = false;
    binding.li.classList.remove("is-pending-undo", "is-open");
    updateCheckoutSummary();
  }

  // binding's own window ran out unused. Its item is already gone from
  // storage (removed back when Unselect was first clicked) — this only
  // ever touches the DOM, and only in one of two ways: if this was the
  // last row standing, crossfade the whole list to empty instead of
  // collapsing the row (see crossfadeToEmpty's own comment); otherwise,
  // the same collapse-then-remove every row used to do immediately on
  // Unselect — now deferred to here, and now genuinely a single motion for
  // this row, since nothing about it moved or resized while it was
  // pending.
  function confirmRemoval(binding) {
    var i = rowBindings.indexOf(binding);
    if (i !== -1) rowBindings.splice(i, 1);

    if (!rowBindings.length) {
      crossfadeToEmpty();
      return;
    }

    suppressHoverUntilMove = true;
    var li = binding.li;
    li.classList.add("is-removing");
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      li.remove();
    }
    li.addEventListener("transitionend", function onEnd(e) {
      if (e.propertyName !== "max-height") return;
      li.removeEventListener("transitionend", onEnd);
      finish();
    });
    // Fallback in case transitionend never fires (e.g. reduced-motion
    // environments that skip the transition outright) — same 400ms
    // backstop js/selection-bar.js's own icon-collapse animation uses.
    setTimeout(finish, 400);
  }

  // binding: { item, index, ... } — see the "undo" section above for the
  // rest of its fields, filled in here (li, undoBtn) and by
  // handleUnselect/handleUndo/confirmRemoval as the row's own undo window
  // plays out.
  function buildItemRow(binding) {
    var item = binding.item;
    var li = document.createElement("li");
    li.className = "order-item";
    binding.li = li;

    var content = document.createElement("div");
    content.className = "order-item__content";

    var thumb = document.createElement("img");
    thumb.className = "order-item__thumb";
    if (item.image) thumb.src = item.image;
    thumb.alt = "";

    var meta = document.createElement("div");
    meta.className = "order-item__meta";
    var name = document.createElement("span");
    name.className = "order-item__name";
    name.textContent = item.name;
    var attrs = document.createElement("span");
    attrs.className = "order-item__attrs";
    attrs.textContent = "." + item.category + "." + item.metal + ".";
    window.EmjiveSelection.appendSize(attrs, item.size);
    // No space between them either — the two read as one continuous label
    // (the period already reads as a separator) rather than two chips with
    // any gap, flex or otherwise, between them.
    meta.appendChild(name);
    meta.appendChild(attrs);

    var price = document.createElement("span");
    price.className = "order-item__price";
    price.textContent = window.EmjiveSelection.formatPrice(item.price);

    content.appendChild(thumb);
    content.appendChild(meta);
    content.appendChild(price);

    var overlay = document.createElement("div");
    overlay.className = "order-item__overlay";

    var modifyBtn = document.createElement("button");
    modifyBtn.type = "button";
    modifyBtn.className = "order-item__overlay-btn";
    modifyBtn.dataset.action = "modify";
    modifyBtn.textContent = "Modify";
    modifyBtn.addEventListener("click", function () {
      closeOpenRow();
      openModifyModal(binding.item, binding.index);
    });

    var unselectBtn = document.createElement("button");
    unselectBtn.type = "button";
    unselectBtn.className = "order-item__overlay-btn";
    unselectBtn.dataset.action = "unselect";
    unselectBtn.textContent = "Unselect";
    unselectBtn.addEventListener("click", function () {
      // Clears the open-row bookkeeping directly, without going through
      // closeOpenRow() — that would also revert the overlay/content
      // crossfade an instant before the undo prompt crossfades in, where
      // leaving "is-open" alone lets that be one continuous swap instead
      // (.is-pending-undo wins over .is-open in css/style.css regardless).
      if (openRowPanel && openRowPanel.root === li) {
        if (window.EmjiveMenus) window.EmjiveMenus.closed(openRowPanel);
        openRowPanel = null;
      }
      handleUnselect(binding);
    });

    overlay.appendChild(modifyBtn);
    overlay.appendChild(unselectBtn);

    // ---- undo prompt: swapped in for content/overlay while pending, in
    // place — see css/style.css's .order-item__undo-prompt and the "undo"
    // section above. Deliberately just the button, nothing else.
    var undoPrompt = document.createElement("div");
    undoPrompt.className = "order-item__undo-prompt";
    var undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "order-item__undo-btn";
    undoBtn.textContent = "Undo";
    undoBtn.addEventListener("click", function () { handleUndo(binding); });
    undoPrompt.appendChild(undoBtn);
    binding.undoBtn = undoBtn;

    // Wrapped rather than appended straight to li — see .order-item__inner
    // in css/style.css: this is what carries the max-height/overflow
    // removal-animation clipping, kept off .order-item itself so it never
    // clips ::before's own full-bleed invert band.
    var inner = document.createElement("div");
    inner.className = "order-item__inner";
    inner.appendChild(content);
    inner.appendChild(overlay);
    inner.appendChild(undoPrompt);
    li.appendChild(inner);

    li.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "mouse" && !suppressHoverUntilMove && !binding.pending) openRowOverlay(li);
    });
    li.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse" && openRowPanel && openRowPanel.root === li) closeOpenRow();
    });
    // focusin/focusout (not focus/blur) bubble, so this can be delegated
    // once on the row itself instead of on each button individually.
    li.addEventListener("focusin", function () {
      if (!binding.pending) openRowOverlay(li);
    });
    li.addEventListener("focusout", function (e) {
      if (!li.contains(e.relatedTarget)) closeOpenRow();
    });
    // Touch's own path: a tap fires this with the overlay still closed
    // (pointerenter above ignores non-mouse pointers), so it opens here
    // instead. A click landing on Modify/Unselect/Undo themselves is
    // excluded — those already handle themselves — but once open, a click
    // anywhere else on the row (the overlay's own empty space, since it
    // covers .order-item__content entirely) closes it back to the normal
    // view rather than being ignored, giving touch a way to back out
    // without picking either action.
    // The undoBtn exclusion isn't just belt-and-suspenders: handleUndo
    // (fired by undoBtn's own listener first, same event, before it
    // bubbles here) already flips binding.pending back to false
    // synchronously, so by the time this handler runs the leading
    // `if (binding.pending) return;` below no longer catches an Undo
    // click — without also matching the button itself here, that click
    // would fall through and immediately reopen the Modify/Unselect
    // overlay on the row it just restored.
    li.addEventListener("click", function (e) {
      if (e.target.closest(".order-item__overlay-btn, .order-item__undo-btn")) return;
      if (binding.pending) return;
      if (li.classList.contains("is-open")) {
        closeOpenRow();
      } else {
        openRowOverlay(li);
      }
    });

    return li;
  }

  /* ---- "Modify" popup -------------------------------------------------------
     Same size-modal pattern product.html's Select button uses (same CSS
     classes, same standard/custom size wiring), with a metal picker
     (.product-metals, also product.html's own classes) added above it,
     since changing metal changes price (data.md's per-metal-specs). The
     static controls (input/guide toggle/backdrop/confirm/Escape) are wired
     exactly once, below — unlike product.js, where the product never
     changes across a page view, here a different row's item/product can
     sit behind this same modal on each open, so those handlers read
     whatever modifyState holds at the moment they fire rather than closing
     over a product captured at wire time. */
  var modifyModal = document.getElementById("modifyModal");
  var modifyModalBackdrop = document.getElementById("modifyModalBackdrop");
  var modifyModalMetalOptions = document.getElementById("modifyModalMetalOptions");
  var modifyModalStandardRow = document.getElementById("modifyModalStandardRow");
  var modifyModalStandardOptions = document.getElementById("modifyModalStandardOptions");
  var modifyModalCustomRow = document.getElementById("modifyModalCustomRow");
  var modifyModalCustomInput = document.getElementById("modifyModalCustomInput");
  var modifyModalCustomUnit = document.getElementById("modifyModalCustomUnit");
  var modifyModalGuideToggle = document.getElementById("modifyModalGuideToggle");
  var modifyModalGuide = document.getElementById("modifyModalGuide");
  var modifyModalConfirm = document.getElementById("modifyModalConfirm");

  var modifyState = {
    product: null,
    index: null,
    metals: [],
    selectedMetal: null,
    selectedSize: null
  };

  function renderModifyMetalOptions() {
    modifyModalMetalOptions.innerHTML = "";
    modifyState.metals.forEach(function (metal) {
      var optionWrap = document.createElement("div");
      optionWrap.className = "product-metals__option-wrap";
      optionWrap.classList.toggle("is-selected", metal === modifyState.selectedMetal);

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "product-metals__option";
      btn.dataset.metal = metal;
      btn.setAttribute("aria-label", metal);
      btn.addEventListener("click", function () {
        if (metal === modifyState.selectedMetal) return;
        modifyState.selectedMetal = metal;
        renderModifyMetalOptions();
      });

      var label = document.createElement("span");
      label.className = "product-metals__option-label";
      label.textContent = metal;

      optionWrap.appendChild(btn);
      optionWrap.appendChild(label);
      modifyModalMetalOptions.appendChild(optionWrap);
    });
  }

  function selectModifyStandardSize(size, btn) {
    modifyState.selectedSize = size;
    modifyModalConfirm.disabled = false;
    modifyModalStandardOptions.querySelectorAll(".size-modal__standard-option").forEach(function (b) {
      b.classList.toggle("is-selected", b === btn);
    });
    modifyModalCustomRow.classList.remove("is-selected");
    modifyModalCustomInput.value = "";
  }

  // currentSize pre-fills the picker to the item's existing size, standard
  // or custom — mirroring product.js's blank-start wiring, just seeded.
  function renderModifySizeOptions(sizes, unit, currentSize) {
    modifyModalCustomUnit.textContent = unit;
    modifyModalStandardRow.hidden = sizes.length === 0;

    modifyModalStandardOptions.innerHTML = "";
    var matchedStandard = false;
    sizes.forEach(function (size) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "size-modal__standard-option";
      btn.textContent = size;
      if (size === currentSize) {
        btn.classList.add("is-selected");
        matchedStandard = true;
      }
      btn.addEventListener("click", function () { selectModifyStandardSize(size, btn); });
      modifyModalStandardOptions.appendChild(btn);
    });

    var isCustom = !matchedStandard && !!currentSize;
    modifyModalCustomRow.classList.toggle("is-selected", isCustom);
    modifyModalCustomInput.value = isCustom ? currentSize : "";
    modifyState.selectedSize = currentSize || null;
    modifyModalConfirm.disabled = !currentSize;
  }

  modifyModalCustomInput.addEventListener("input", function () {
    // Digits and at most one decimal point, capped at two decimal places
    // (e.g. "59.43") — inputmode="decimal" triggers the numeric keypad on
    // mobile; this backstops desktop typing/paste. The comma-to-dot swap
    // up front is for French (and other comma-decimal) mobile keypads,
    // whose decimal key sends "," — without it, that keypress would just
    // get stripped by the digits-and-dot filter below instead of
    // registering as one.
    var cleaned = modifyModalCustomInput.value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
    var firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    }
    modifyModalCustomInput.value = cleaned;
    modifyModalStandardOptions.querySelectorAll(".size-modal__standard-option").forEach(function (b) {
      b.classList.remove("is-selected");
    });
    if (cleaned) {
      modifyState.selectedSize = cleaned;
      modifyModalConfirm.disabled = false;
      modifyModalCustomRow.classList.add("is-selected");
    } else {
      modifyState.selectedSize = null;
      modifyModalConfirm.disabled = true;
      modifyModalCustomRow.classList.remove("is-selected");
    }
  });

  modifyModalGuideToggle.addEventListener("click", function () {
    modifyModalGuide.classList.toggle("is-open");
  });

  function closeModifyModal() {
    modifyModal.classList.remove("is-open");
    modifyModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-modal-open");
  }

  modifyModalBackdrop.addEventListener("click", closeModifyModal);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modifyModal.classList.contains("is-open")) closeModifyModal();
  });

  modifyModalConfirm.addEventListener("click", function () {
    if (!modifyState.selectedSize) return;
    var details = (modifyState.product["per-metal-specs"] && modifyState.product["per-metal-specs"][modifyState.selectedMetal]) || {};
    window.EmjiveSelection.updateItem(modifyState.index, {
      metal: modifyState.selectedMetal,
      size: modifyState.selectedSize,
      price: details.price || 0,
      image: (modifyState.product.assets && modifyState.product.assets.icons && modifyState.product.assets.icons[modifyState.selectedMetal]) || ""
    });
    closeModifyModal();
    render();
  });

  // Product ids are only unique within a series (see selection.js) — falls
  // back to the active series for a pre-refactor selection saved without
  // one. A genuine miss (the product no longer exists in that series'
  // catalog) leaves the modal unopened with an explanation, same "can't do
  // that right now" alert() convention the checkout button stub uses.
  function openModifyModal(item, index) {
    window.EmjiveSeries.ready.then(function () {
      var slug = item.series || window.EmjiveSeries.slug;
      return window.EmjiveSeries.loadProducts(slug).then(function (products) {
        var product = products.find(function (p) { return p.id === item.productId; });
        if (!product) {
          alert("This item's original product listing couldn't be found, so it can't be modified here.");
          return;
        }

        modifyState.product = product;
        modifyState.index = index;
        modifyState.metals = window.EmjiveSeries.metals || [];
        modifyState.selectedMetal = item.metal;

        renderModifyMetalOptions();

        var info = window.EmjiveSeries.categoryInfo(item.category);
        renderModifySizeOptions(info.sizes || [], info.unit || "", item.size);

        modifyModalGuide.classList.remove("is-open");
        modifyModal.classList.add("is-open");
        modifyModal.setAttribute("aria-hidden", "false");
        document.body.classList.add("is-modal-open");
      });
    });
  }

  /* ---- shipping ------------------------------------------------------- */

  function renderShippingOptions() {
    shippingOptionsEl.innerHTML = "";
    SHIPPING_OPTIONS.forEach(function (option) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "order-shipping__option";
      btn.classList.toggle("is-selected", option.id === selectedShippingId);

      var name = document.createElement("span");
      name.className = "order-shipping__option-name";
      name.textContent = option.name;

      var price = document.createElement("span");
      price.className = "order-shipping__option-price";
      price.textContent = option.price ? window.EmjiveSelection.formatPrice(option.price) : "Free";

      btn.appendChild(name);
      btn.appendChild(price);
      btn.addEventListener("click", function () {
        selectedShippingId = option.id;
        renderShippingOptions();
        updateCheckoutGate();
      });
      shippingOptionsEl.appendChild(btn);
    });
  }

  /* ---- terms --------------------------------------------------------------
     A single delegated listener on the whole row: clicking the dedicated
     tick box or the surrounding sentence both flip it, but a click that
     lands on the "terms & conditions" link inside that sentence navigates
     instead — same "toggle vs. its own separately-clickable label" split
     js/selection-bar.js uses for its drawer toggle/empty-label pair. */
  termsEl.addEventListener("click", function (e) {
    if (e.target.closest("a")) return;
    termsAccepted = !termsAccepted;
    termsToggleEl.classList.toggle("is-checked", termsAccepted);
    termsToggleEl.setAttribute("aria-pressed", String(termsAccepted));
    updateCheckoutGate();
  });

  /* ---- checkout -------------------------------------------------------
     No backend yet — same "isn't connected yet" stub js/main.js's contact
     form uses, until a real Stripe Checkout session exists to redirect to. */
  checkoutButton.addEventListener("click", function () {
    if (checkoutButton.disabled) return;
    alert("Checkout isn't connected yet. Wire this up to a Stripe Checkout session once the backend exists.");
  });

  /* ---- render ----------------------------------------------------------- */

  // Full rebuild — only still needed for the initial page load and after
  // a Modify confirm (updateItem patches an existing item in place, and a
  // fresh render is the simplest way to reflect that). Unselect/Undo no
  // longer go through here at all — see the "undo" section above — so
  // this never runs mid-undo-window in the common case. If it *does* (a
  // Modify confirmed on one row while a different row is still pending),
  // every rowBindings entry's own timer is cleared first and the rebuild
  // below repopulates straight from current storage, which already
  // reflects that other row's item as removed — its grace period ends
  // early, silently, rather than surviving the rebuild. Rare enough
  // (requires two different rows mid-interaction at once) not to be worth
  // engineering around.
  function render() {
    closeOpenRow();
    rowBindings.forEach(function (b) {
      if (b.timer) clearTimeout(b.timer);
    });

    var items = window.EmjiveSelection.getSelection();

    if (!items.length) {
      rowBindings = [];
      emptyEl.hidden = false;
      listEl.hidden = true;
      checkoutBar.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;

    itemsEl.innerHTML = "";
    rowBindings = items.map(function (item, index) {
      return { item: item, index: index, pending: false, timer: null };
    });
    rowBindings.forEach(function (binding) {
      itemsEl.appendChild(buildItemRow(binding));
    });

    updateCheckoutSummary();
  }

  renderShippingOptions();
  updateCheckoutGate();
  render();
})();
