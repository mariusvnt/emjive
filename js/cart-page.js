/* ==========================================================================
   J&MV — cart page
   Renders window.EmjiveCart's contents into cart.html, or falls back to
   the static .cart-empty block when there's nothing in it.
   ========================================================================== */

(function () {
  "use strict";

  var listEl = document.getElementById("cartList");
  if (!listEl) return;

  var emptyEl = document.getElementById("cartEmpty");
  var itemsEl = document.getElementById("cartItems");
  var totalEl = document.getElementById("cartTotal");

  function render() {
    var items = window.EmjiveCart.getCart();

    if (!items.length) {
      emptyEl.hidden = false;
      listEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    listEl.hidden = false;

    itemsEl.innerHTML = "";
    var total = 0;
    items.forEach(function (item, index) {
      total += item.price || 0;
      itemsEl.appendChild(buildRow(item, index));
    });
    totalEl.textContent = window.EmjiveCart.formatPrice(total);
  }

  function buildRow(item, index) {
    var li = document.createElement("li");
    li.className = "cart-item";

    var thumb = document.createElement("img");
    thumb.className = "cart-item__thumb";
    // Empty src="" would make the browser re-request the current page —
    // only set it when there's an actual thumbnail (Foramen/Disc have
    // none yet).
    if (item.image) thumb.src = item.image;
    thumb.alt = "";

    var meta = document.createElement("div");
    meta.className = "cart-item__meta";
    var name = document.createElement("span");
    name.className = "cart-item__name";
    name.textContent = item.name;
    var attrs = document.createElement("span");
    attrs.className = "cart-item__attrs";
    attrs.textContent = "." + item.category + " · " + item.metal + " · size " + item.size;
    meta.appendChild(name);
    meta.appendChild(attrs);

    var price = document.createElement("span");
    price.className = "cart-item__price";
    price.textContent = window.EmjiveCart.formatPrice(item.price);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "cart-item__remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", function () {
      window.EmjiveCart.removeItem(index);
      render();
    });

    li.appendChild(thumb);
    li.appendChild(meta);
    li.appendChild(price);
    li.appendChild(removeBtn);
    return li;
  }

  render();
})();
