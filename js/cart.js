/* ==========================================================================
   J&MV — cart storage
   Plain localStorage-backed cart, exposed as window.EmjiveCart. Loaded on
   product.html (adds items) and cart.html (lists/removes them) before the
   page-specific script.
   ========================================================================== */

(function (global) {
  "use strict";

  var STORAGE_KEY = "emjive_cart";

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

  function getCart() {
    return readAll();
  }

  // item: { productId, name, category, metal, size, price, image } — a
  // self-contained snapshot, so cart.html never needs to re-fetch/join
  // against products.json to render itself.
  function addItem(item) {
    var items = readAll();
    items.push(item);
    writeAll(items);
    return items;
  }

  function removeItem(index) {
    var items = readAll();
    items.splice(index, 1);
    writeAll(items);
    return items;
  }

  function clear() {
    writeAll([]);
  }

  function formatPrice(price) {
    return price > 0 ? "€ " + price : "Price on request";
  }

  global.EmjiveCart = {
    getCart: getCart,
    addItem: addItem,
    removeItem: removeItem,
    clear: clear,
    formatPrice: formatPrice
  };
})(window);
