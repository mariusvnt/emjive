/* ==========================================================================
   J&MV — order page
   Renders window.EmjiveSelection's contents into launch-order.html, or
   falls back to the static .selection-empty block when there's nothing in
   it.
   ========================================================================== */

(function () {
  "use strict";

  var listEl = document.getElementById("selectionList");
  if (!listEl) return;

  var emptyEl = document.getElementById("selectionEmpty");
  var itemsEl = document.getElementById("selectionItems");
  var totalEl = document.getElementById("selectionTotal");

  function render() {
    var items = window.EmjiveSelection.getSelection();

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
    totalEl.textContent = window.EmjiveSelection.formatPrice(total);
  }

  function buildRow(item, index) {
    var li = document.createElement("li");
    li.className = "selection-item";

    var thumb = document.createElement("img");
    thumb.className = "selection-item__thumb";
    // Empty src="" would make the browser re-request the current page —
    // only set it when there's an actual thumbnail (Foramen/Disc have
    // none yet).
    if (item.image) thumb.src = item.image;
    thumb.alt = "";

    var meta = document.createElement("div");
    meta.className = "selection-item__meta";
    var name = document.createElement("span");
    name.className = "selection-item__name";
    name.textContent = item.name;
    var attrs = document.createElement("span");
    attrs.className = "selection-item__attrs";
    attrs.textContent = "." + item.category + " · " + item.metal + " · size " + item.size;
    meta.appendChild(name);
    meta.appendChild(attrs);

    var price = document.createElement("span");
    price.className = "selection-item__price";
    price.textContent = window.EmjiveSelection.formatPrice(item.price);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "selection-item__remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", function () {
      window.EmjiveSelection.removeItem(index);
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
