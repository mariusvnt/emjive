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
     A plain text row (built on .order-item itself, so it gets that class's
     collapse animation and invert band for free — see css/style.css) that
     appears at the top of the list after an Unselect and offers to put the
     item straight back where it was. Every removal pushes onto undoStack
     rather than replacing a single pending one, so unselecting several
     items in a row keeps all of them undo-able — one click brings back the
     most recent, a second brings back the one before that, and so on
     (undoStack.pop() below), same order the removals themselves happened
     in. Each entry's own index was captured relative to the array as it
     stood right after its own removal, which is exactly what popping in
     that same reverse order needs to stay correct — no re-shifting math
     required, since restoring the most recent removal first always exactly
     reverses just that one mutation. */
  var UNDO_TIMEOUT_MS = 6000;
  // How long the bar lingers after the very last pending undo is used,
  // before it actually goes away — long enough for the restored row's own
  // grow-in (see playRowEnterAnimation) to have visibly started, rather
  // than the bar vanishing before that's even begun playing.
  var UNDO_LINGER_MS = 800;
  var undoTimer = null;
  var undoStack = []; // [{ item, index, thumbEl }], oldest first
  var undoBarEl = null;

  function clearUndoTimer() {
    if (undoTimer) {
      clearTimeout(undoTimer);
      undoTimer = null;
    }
  }

  // Shrinks the bar away (same is-removing collapse .order-item already
  // uses elsewhere) and removes it from the DOM once that's actually
  // finished — onHidden (used by the Undo button itself) only runs then,
  // so restoring the item and rebuilding the list never yanks the node
  // this same animation is running on out from under it.
  function hideUndoBar(onHidden) {
    if (!undoBarEl) {
      if (onHidden) onHidden();
      return;
    }
    // Collapsing this bar reflows the row(s) below it up the page under a
    // possibly-stationary cursor — same phantom-pointerenter risk a row's
    // own removal has, guarded the same way.
    suppressHoverUntilMove = true;
    var bar = undoBarEl;
    undoBarEl = null;
    bar.classList.add("is-removing");
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      bar.remove();
      if (onHidden) onHidden();
    }
    bar.addEventListener("transitionend", function onEnd(e) {
      if (e.propertyName !== "max-height") return;
      bar.removeEventListener("transitionend", onEnd);
      finish();
    });
    setTimeout(finish, 400);
  }

  // Timeout expired without the user clicking Undo — nothing left to undo.
  function dismissUndo() {
    clearUndoTimer();
    undoStack = [];
    hideUndoBar();
  }

  // After the very last pending undo is used, the bar doesn't disappear on
  // the spot — it's put straight back (reusing the same node, same
  // no-animation technique showUndoBar()'s reuse branch below uses, since
  // render() has already detached it from the DOM either way) and left up
  // for UNDO_LINGER_MS, so there's a real moment where the restored row and
  // the bar are both visible together before the bar actually fades away.
  function lingerThenHideUndoBar() {
    if (!undoBarEl) return;
    itemsEl.insertBefore(undoBarEl, itemsEl.firstChild);
    clearUndoTimer();
    undoTimer = setTimeout(function () {
      undoTimer = null;
      hideUndoBar();
    }, UNDO_LINGER_MS);
  }

  function buildUndoBar() {
    var li = document.createElement("li");
    li.className = "order-item order-items__undo";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "order-items__undo-btn";
    btn.textContent = "Undo";
    // Reads undoStack fresh rather than closing over a particular item, so
    // this same bar/button (kept alive across consecutive actions — see
    // showUndoBar()) always undoes whatever's currently on top of it,
    // regardless of how many times it's been reused since it was built.
    btn.addEventListener("click", function () {
      if (!undoStack.length) return;
      var restore = undoStack.pop();
      clearUndoTimer();

      // Restored immediately either way — render()'s rebuild detaches the
      // bar from the DOM as a side effect regardless of whether more is
      // still pending, so there's nothing to gain by waiting for an exit
      // animation to finish first (see showUndoBar()'s reuse note).
      window.EmjiveSelection.insertItem(restore.index, restore.item);
      render(restore.index, restore.thumbEl);

      if (undoStack.length) {
        // Still more to undo — keep the bar up for those, same as always.
        showUndoBar();
      } else {
        // Nothing left, but let the restored row actually be seen before
        // taking the bar away.
        lingerThenHideUndoBar();
      }
    });
    li.appendChild(btn);
    return li;
  }

  // Ensures a bar exists for whatever's now on top of undoStack and
  // (re)starts its dismiss timer — called after every removal
  // (removeRowSmoothly, which pushes onto the stack first) and after an
  // Undo click that still leaves something pending. Reuses undoBarEl as-is
  // when one's already up rather than rebuilding: render() (called right
  // before this in both cases) already wiped .order-items via
  // innerHTML = "", detaching whatever bar was showing along with every
  // row, but that doesn't invalidate the element itself — reinserting the
  // very same node, with no animation, is what makes several unselects or
  // undos in a row read as the bar having stayed there continuously
  // instead of flickering out and back in on every single one. It's only
  // actually built and animated in the first time, when nothing was
  // showing yet.
  function showUndoBar() {
    clearUndoTimer();
    if (!undoStack.length) return;

    if (undoBarEl) {
      itemsEl.insertBefore(undoBarEl, itemsEl.firstChild);
    } else {
      var bar = buildUndoBar();
      // Same enter technique as playEnterAnimation() in js/selection-bar.js,
      // plus the double-rAF playRowEnterAnimation() above needs: start
      // collapsed, force a layout flush, then wait a full extra frame
      // before flipping to the expanded state — a single rAF can still
      // land in the same frame as the forced layout, before the browser
      // has actually painted the collapsed state, coalescing the whole
      // thing into one paint with no transition ever registering.
      bar.classList.add("is-removing");
      itemsEl.insertBefore(bar, itemsEl.firstChild);
      undoBarEl = bar;
      void bar.offsetWidth;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          bar.classList.remove("is-removing");
        });
      });
    }

    undoTimer = setTimeout(dismissUndo, UNDO_TIMEOUT_MS);
  }

  // Same collapse-then-remove convention as js/selection-bar.js's
  // handleUnselect: the row visibly shrinks to nothing first (CSS
  // transition on .order-item's own max-height/padding/opacity —
  // "is-removing" in css/style.css), which is also what makes the rows
  // below it slide up smoothly, as a side effect of .order-items' flex
  // column recalculating layout every frame. Only once that's finished is
  // the item actually removed from storage and the list rebuilt — doing
  // that immediately would yank the very node the animation is running on
  // out of the DOM before it ever played. item is kept around (not just
  // index) so showUndoBar has something to restore afterward.
  function removeRowSmoothly(li, item, index) {
    suppressHoverUntilMove = true;
    li.classList.add("is-removing");
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      // Pulled off the row before it's discarded (render() below rebuilds
      // .order-items from scratch, and this exact node isn't part of that
      // any more once the item's removed from storage) — kept alive for
      // as long as the undo window is, so a restore can reuse it as-is.
      var thumbEl = li.querySelector(".order-item__thumb");
      window.EmjiveSelection.removeItem(index);
      render();
      // Only if the list isn't now empty — .order-items (and any undo bar
      // in it) is hidden along with the rest of .selection-list once
      // there's nothing left, so there'd be nowhere for it to show.
      if (window.EmjiveSelection.getSelection().length) {
        undoStack.push({ item: item, index: index, thumbEl: thumbEl });
        showUndoBar();
      }
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

  // reuseThumbEl — only ever passed for the one row Undo is restoring (see
  // render()) — is that item's own already-built <img>, still holding its
  // already-loaded/decoded image: appending an existing node just moves it,
  // it doesn't reload, so the restored row's thumbnail is available
  // instantly instead of needing a fresh decode the moment it reappears.
  function buildItemRow(item, index, reuseThumbEl) {
    var li = document.createElement("li");
    li.className = "order-item";

    var content = document.createElement("div");
    content.className = "order-item__content";

    var thumb = reuseThumbEl || document.createElement("img");
    thumb.className = "order-item__thumb";
    // Empty src="" would make the browser re-request the current page —
    // only set it when there's an actual thumbnail. Skipped when reusing:
    // it's already carrying the right one.
    if (!reuseThumbEl && item.image) thumb.src = item.image;
    thumb.alt = "";

    var meta = document.createElement("div");
    meta.className = "order-item__meta";
    var name = document.createElement("span");
    name.className = "order-item__name";
    name.textContent = item.name;
    var attrs = document.createElement("span");
    attrs.className = "order-item__attrs";
    attrs.textContent = "." + item.category + "." + item.metal + "." + item.size;
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
      openModifyModal(item, index);
    });

    var unselectBtn = document.createElement("button");
    unselectBtn.type = "button";
    unselectBtn.className = "order-item__overlay-btn";
    unselectBtn.dataset.action = "unselect";
    unselectBtn.textContent = "Unselect";
    unselectBtn.addEventListener("click", function () {
      // Clears the open-row bookkeeping directly, without going through
      // closeOpenRow() — that would also revert the overlay/content
      // crossfade an instant before the row starts collapsing (a flash
      // back to the price view), where leaving "is-open" alone lets the
      // whole row — overlay included — shrink away as one continuous
      // motion instead.
      if (openRowPanel && openRowPanel.root === li) {
        if (window.EmjiveMenus) window.EmjiveMenus.closed(openRowPanel);
        openRowPanel = null;
      }
      removeRowSmoothly(li, item, index);
    });

    overlay.appendChild(modifyBtn);
    overlay.appendChild(unselectBtn);

    li.appendChild(content);
    li.appendChild(overlay);

    li.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "mouse" && !suppressHoverUntilMove) openRowOverlay(li);
    });
    li.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse" && openRowPanel && openRowPanel.root === li) closeOpenRow();
    });
    // focusin/focusout (not focus/blur) bubble, so this can be delegated
    // once on the row itself instead of on each button individually.
    li.addEventListener("focusin", function () { openRowOverlay(li); });
    li.addEventListener("focusout", function (e) {
      if (!li.contains(e.relatedTarget)) closeOpenRow();
    });
    // Touch's own path: a tap fires this with the overlay still closed
    // (pointerenter above ignores non-mouse pointers), so it opens here
    // instead. A click landing on Modify/Unselect themselves is excluded —
    // those already handle themselves — but once open, a click anywhere
    // else on the row (the overlay's own empty space, since it covers
    // .order-item__content entirely) closes it back to the normal view
    // rather than being ignored, giving touch a way to back out without
    // picking either action.
    li.addEventListener("click", function (e) {
      if (e.target.closest(".order-item__overlay-btn")) return;
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
     since changing metal changes price (data.md's metalDetails). The
     static controls (input/guide toggle/backdrop/confirm/Escape) are wired
     exactly once, below — unlike product.js, where the product never
     changes across a page view, here a different row's item/product can
     sit behind this same modal on each open, so those handlers read
     whatever modifyState holds at the moment they fire rather than closing
     over a product captured at wire time. */
  var modifyModal = document.getElementById("modifyModal");
  var modifyModalBackdrop = document.getElementById("modifyModalBackdrop");
  var modifyModalTitleName = document.getElementById("modifyModalTitleName");
  var modifyModalTitleType = document.getElementById("modifyModalTitleType");
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
    // Digits and at most one decimal point — inputmode="decimal" triggers
    // the numeric keypad on mobile; this backstops desktop typing/paste.
    var cleaned = modifyModalCustomInput.value.replace(/[^0-9.]/g, "");
    var firstDot = cleaned.indexOf(".");
    if (firstDot !== -1) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
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
    var details = (modifyState.product.metalDetails && modifyState.product.metalDetails[modifyState.selectedMetal]) || {};
    window.EmjiveSelection.updateItem(modifyState.index, {
      metal: modifyState.selectedMetal,
      size: modifyState.selectedSize,
      price: details.price || 0,
      image: (modifyState.product.icons && modifyState.product.icons[modifyState.selectedMetal]) || ""
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

        modifyModalTitleName.textContent = item.name;
        modifyModalTitleType.textContent = "." + item.category;
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

  // Growing a row in from .is-removing's collapsed state (max-height: 0 +
  // overflow: hidden on .order-item) also clips .order-item__content, which
  // is centered — so while the box is still short, different children
  // reveal at different rates (the thumb's fixed 3rem taking longer to
  // clear than the shorter text next to it), reading as staggered/
  // unpolished rather than one row appearing as a unit. Keeping the
  // content invisible (a plain inline opacity override, cleared once this
  // plays out) until the box's own max-height/padding transition is
  // essentially done, then fading the whole thing in as one block, avoids
  // ever compositing a partial, unevenly-clipped frame of it. Same
  // set-inline-then-clear-after-transitionend convention as
  // js/selection-bar.js's playEnterAnimation.
  function playRowEnterAnimation(row) {
    var content = row.querySelector(".order-item__content");
    if (content) {
      content.style.transition = "none";
      content.style.opacity = "0";
    }
    void row.offsetWidth;
    // A single requestAnimationFrame can still land in the same frame as
    // the offsetWidth-forced layout above, before the browser has actually
    // painted this collapsed/invisible starting state — removing
    // is-removing (and restoring content's opacity) that early coalesces
    // the whole thing into one paint with no transition ever registering,
    // which is exactly what read as the row — and .order-item::before's
    // middle band with it — snapping straight to its end state instead of
    // fading/growing smoothly. A second, nested rAF guarantees a real
    // paint has actually happened in between the two.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        row.classList.remove("is-removing");
        if (!content) return;
        // Deliberately its own pace, decoupled from the row's own
        // height/padding growth (0.3s/0.25s, untouched) — same values as
        // .order-item::before's own opacity transition in css/style.css,
        // so the row's elements and the middle band fade in together.
        content.style.transition = "opacity 0.15s ease 0.4s";
        content.style.opacity = "1";
        content.addEventListener("transitionend", function onEnd(e) {
          if (e.propertyName !== "opacity") return;
          content.removeEventListener("transitionend", onEnd);
          // Clears the inline override so .order-item__content's own CSS
          // rule (the hover/tap overlay crossfade, unrelated to this)
          // governs it again — not a fixed 0.2s-delayed fade forever after.
          content.style.transition = "";
          content.style.opacity = "";
        });
      });
    });
  }

  // enterIndex (only ever passed by Undo, above) marks one freshly-rebuilt
  // row to play the mirror image of the removal collapse — grown in from
  // nothing instead of shrunk away — via the same .order-item/is-removing
  // pairing and enter technique showUndoBar() uses for its own bar.
  // enterThumbEl, that row's own already-loaded thumbnail (see
  // removeRowSmoothly/buildItemRow), gets reused instead of rebuilt — even
  // though itemsEl.innerHTML = "" below detaches it from the DOM along
  // with everything else, that doesn't invalidate this reference, only
  // orphans the node until buildItemRow reattaches it a few lines later.
  function render(enterIndex, enterThumbEl) {
    closeOpenRow();
    var items = window.EmjiveSelection.getSelection();

    if (!items.length) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      checkoutBar.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;
    checkoutBar.hidden = false;

    itemsEl.innerHTML = "";
    var total = 0;
    var enterEl = null;
    items.forEach(function (item, index) {
      total += item.price || 0;
      var row = buildItemRow(item, index, index === enterIndex ? enterThumbEl : null);
      if (index === enterIndex) {
        row.classList.add("is-removing");
        enterEl = row;
      }
      itemsEl.appendChild(row);
    });
    checkoutTotalEl.textContent = window.EmjiveSelection.formatPrice(total);

    if (enterEl) playRowEnterAnimation(enterEl);
  }

  renderShippingOptions();
  updateCheckoutGate();
  render();
})();
