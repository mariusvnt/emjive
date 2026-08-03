/* ==========================================================================
   J&MV — selection storage
   Plain localStorage-backed selection, exposed as window.EmjiveSelection.
   Loaded on product.html (adds items), the floating selection bar (adds/
   removes items on every page), and launch-order.html (lists/removes them)
   before each page's own script.
   ========================================================================== */

(function (global) {
  "use strict";

  var STORAGE_KEY = "emjive_selection";

  function readAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeAll(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  // Lets any page-specific script (the floating selection bar especially)
  // react live to a change instead of needing a reload.
  function notify() {
    global.dispatchEvent(new CustomEvent("emjive:selection-changed"));
  }

  function getSelection() {
    return readAll();
  }

  // item: { series, productId, name, category, metal, size, price, image } —
  // a self-contained snapshot, so launch-order.html never needs to re-fetch/
  // join against any products.json to render itself.
  //
  // `series` is what makes productId meaningful: ids are only unique within
  // one series' catalog. Selections saved before it existed simply have no
  // series field, which is fine — nothing here reads it, and the one
  // consumer that keys off productId tolerates it being absent (see
  // itemKey() in js/selection-bar.js).
  function addItem(item) {
    var items = readAll();
    items.push(item);
    writeAll(items);
    notify();
    return items;
  }

  function removeItem(index) {
    var items = readAll();
    items.splice(index, 1);
    writeAll(items);
    notify();
    return items;
  }

  function clear() {
    writeAll([]);
    notify();
  }

  function formatPrice(price) {
    return price > 0 ? "€ " + price : "Price on request";
  }

  global.EmjiveSelection = {
    getSelection: getSelection,
    addItem: addItem,
    removeItem: removeItem,
    clear: clear,
    formatPrice: formatPrice
  };
})(window);
