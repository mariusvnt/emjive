/* ==========================================================================
   em·ji·ve — modal focus trap

   Shared by the site's two dialogs, which are the same component twice:
   #sizeModal (product.html, opened by the Select button) and #modifyModal
   (launch-order.html, opened by an item row's Modify button). Loaded only on
   those two pages — every other page has no modal, and js/series.js (the
   obvious alternative home) is a blocking <head> script on all seven.

   What was missing before this: both dialogs were already marked up
   correctly and already closed on Escape and on a backdrop click, but focus
   never entered them, Tab walked straight out into the page behind, and
   closing left focus wherever it had drifted to. A keyboard visitor opening
   the size picker had to tab through the whole page to reach the size
   buttons, and could tab back out of an "aria-modal" dialog while it was
   still open.

   THE TRAP ROOT IS .size-modal, NEVER .size-modal__panel. The "Size guide"
   toggle lives in .size-modal__guide, which is a SIBLING of the panel, not a
   child — a trap scoped to the panel would leave a reachable control outside
   itself, which is the one thing a trap must not do. Both pages carry
   role="dialog"/aria-modal/aria-label on .size-modal for the same reason:
   a screen reader honouring aria-modal hides everything outside the declared
   dialog, so declaring the panel while trapping the modal would have made
   that toggle tabbable but unreadable.

   A closed modal needs no handling here: .size-modal is visibility: hidden
   when closed (css/style.css), visibility inherits, and an element whose
   computed visibility isn't `visible` is excluded from sequential focus
   navigation outright. Nothing inside either modal redeclares it.
   ========================================================================== */

(function (global) {
  "use strict";

  var FOCUSABLE = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  var activeRoot = null;
  var returnFocusTo = null;
  var fallbackFocusTo = null;
  var onEscape = null;

  // Recomputed on every Tab rather than cached at activate() time, because
  // both dialogs genuinely change shape while open: the standard-size
  // buttons are rebuilt per open (and the whole row is [hidden] for a
  // category with no standard run), the modify modal rebuilds its metal
  // buttons too, and both confirm buttons toggle `disabled` live as a size
  // is picked or cleared. A cached list would go stale within one keystroke.
  function focusable(root) {
    var all = root.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // The same mechanism that already keeps a closed modal untabbable, so
      // one check covers the modal itself and anything inside it that hides
      // the same way later. getClientRects() catches display: none — a
      // [hidden] standard-size row is the live case.
      if (global.getComputedStyle(el).visibility === "hidden") continue;
      if (!el.getClientRects().length) continue;
      out.push(el);
    }
    return out;
  }

  // A target may be given as an element or as a function returning one. The
  // function form is what makes a stale trigger survivable — see release().
  function resolveTarget(want) {
    var el = typeof want === "function" ? want() : want;
    return el && global.document.contains(el) ? el : null;
  }

  function onKeydown(e) {
    if (!activeRoot) return;

    if (e.key === "Escape") {
      if (onEscape) {
        // preventDefault so the same keypress can't also reach something
        // behind the dialog — a native picker on the size input, say.
        e.preventDefault();
        onEscape();
      }
      return;
    }

    if (e.key !== "Tab") return;

    var items = focusable(activeRoot);
    if (!items.length) {
      // Nothing to move to, but focus still must not leave.
      e.preventDefault();
      return;
    }
    var edge = e.shiftKey ? items[0] : items[items.length - 1];
    var wrapTo = e.shiftKey ? items[items.length - 1] : items[0];
    if (document.activeElement === edge || !activeRoot.contains(document.activeElement)) {
      e.preventDefault();
      wrapTo.focus();
    }
  }

  // Focus can leave without a Tab keypress at all — a click on page chrome
  // behind the backdrop, a screen reader's own navigation commands, a
  // browser autofill dropdown handing focus back somewhere unexpected.
  // focusin bubbles, so one document-level listener covers every route.
  function onFocusIn(e) {
    if (!activeRoot || activeRoot.contains(e.target)) return;
    var items = focusable(activeRoot);
    (items[0] || activeRoot).focus();
  }

  global.EmjiveFocusTrap = {
    /* root    — the element focus is confined to (.size-modal; see header).
       options — all optional:
         returnFocus   Element, or a function returning one, resolved at
                       release() time rather than here.
         fallbackFocus same, used when returnFocus resolves to nothing still
                       in the document.
         initialFocus  defaults to root itself, so the dialog's own
                       aria-label is announced before its first control.
         onEscape      called on Escape. Omit to keep your own handler. */
    activate: function (root, options) {
      if (!root) return;
      options = options || {};
      // Defensive: two modals can never be open at once on this site (they
      // live on different pages), but a stacked activate() would otherwise
      // silently orphan the first trap's listeners.
      if (activeRoot) this.release();

      activeRoot = root;
      returnFocusTo = options.returnFocus || document.activeElement;
      fallbackFocusTo = options.fallbackFocus || null;
      onEscape = options.onEscape || null;

      document.addEventListener("keydown", onKeydown);
      document.addEventListener("focusin", onFocusIn);

      // Belt and braces — both modals carry tabindex="-1" in markup, but a
      // root without it would silently swallow focus() and leave the trap
      // anchored on <body>, where onFocusIn would then fight every move.
      if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");

      // preventScroll: the panel is a centred fixed overlay over a body
      // already locked by .is-modal-open, so any scrolling this provoked
      // could only shift .size-modal__panel's own overflow-y box off its
      // top for no reason.
      //
      // Callers MUST call this AFTER adding .is-open — focus() on a
      // visibility: hidden element is a no-op, and the modal is hidden
      // until that class lands.
      (options.initialFocus || root).focus({ preventScroll: true });
    },

    release: function () {
      if (!activeRoot) return;
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("focusin", onFocusIn);
      activeRoot = null;

      // Resolved HERE, not at activate() time, and that is the whole reason
      // returnFocus accepts a function. On launch-order.html the trigger is
      // a per-row .order-item__overlay-btn that is routinely gone by now —
      // not only when the row was unselected, but on the ordinary success
      // path too, since confirming a Modify re-renders the entire list and
      // replaces every row with a fresh one. An element reference captured
      // on open would be detached; a lookup run now finds whatever occupies
      // that slot today.
      var target = resolveTarget(returnFocusTo) || resolveTarget(fallbackFocusTo);
      returnFocusTo = null;
      fallbackFocusTo = null;
      onEscape = null;

      // No preventScroll this time: the trigger may legitimately be
      // off-screen now, and scrolling it back into view is exactly right.
      if (target) target.focus();
    }
  };
})(window);
