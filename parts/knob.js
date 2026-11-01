/* Rotary mode knob. Drag, click or use the arrow keys to move between detents. */
(function () {
  "use strict";

  var SWEEP = 60;      // degrees between detents
  var LIMIT = 80;      // how far the dial turns past the outer detents while dragging

  function create(host, opts) {
    var options = opts.options || [];
    var names = opts.names || options;
    var n = options.length;
    var value = Math.max(0, opts.value || 0);
    var start = -SWEEP * (n - 1) / 2;
    var esc = window.Atlas ? window.Atlas.esc : function (s) { return String(s); };

    function angleOf(i) { return start + i * SWEEP; }

    var html = '<div class="knob">';
    options.forEach(function (label, i) {
      // The labels are mouse shortcuts. The dial itself is the keyboard control.
      html += '<button type="button" class="knob-label" data-i="' + i + '" tabindex="-1" aria-hidden="true">' + esc(label) + "</button>";
    });
    html += '<div class="dial" role="slider" tabindex="0" aria-label="' + esc(opts.label || "Mode") + '"' +
      ' aria-valuemin="1" aria-valuemax="' + n + '" aria-orientation="horizontal">' +
      '<div class="dial-ring" aria-hidden="true">';
    options.forEach(function (_, i) {
      html += '<span class="dial-tick" data-i="' + i + '" style="transform: rotate(' + angleOf(i) + 'deg)"></span>';
    });
    html += '</div><div class="dial-face" aria-hidden="true"><span class="dial-pointer"></span><span class="dial-cap"></span></div></div></div>';
    host.innerHTML = html;

    var root = host.querySelector(".knob");
    var dial = host.querySelector(".dial");
    var labels = host.querySelectorAll(".knob-label");
    var ticks = host.querySelectorAll(".dial-tick");

    function paint(angle) {
      root.style.setProperty("--angle", angle + "deg");
    }

    function pulse() {
      dial.classList.remove("is-click");
      void dial.offsetWidth;
      dial.classList.add("is-click");
    }

    function set(i, notify) {
      i = Math.max(0, Math.min(n - 1, i));
      var changed = i !== value;
      value = i;
      paint(angleOf(i));
      dial.setAttribute("aria-valuenow", String(i + 1));
      dial.setAttribute("aria-valuetext", names[i]);
      labels.forEach(function (l, j) { l.classList.toggle("is-active", j === i); });
      ticks.forEach(function (t, j) { t.classList.toggle("is-active", j === i); });
      if (changed) pulse();
      if (notify && opts.onChange) opts.onChange(i);
    }

    // Keyboard
    dial.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + 1;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - 1;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n - 1;
      else if (e.key === "Enter" || e.key === " ") next = (value + 1) % n;
      if (next === null) return;
      e.preventDefault();
      set(next, true);
    });

    // Labels
    labels.forEach(function (l) {
      l.addEventListener("click", function () { set(+l.getAttribute("data-i"), true); });
    });

    // Drag, or click to step to the next detent
    var drag = null;
    function pointerAngle(e) {
      var r = dial.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      return Math.atan2(dx, -dy) * 180 / Math.PI; // 0 is straight up
    }
    dial.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false, angle: angleOf(value) };
      try { dial.setPointerCapture(e.pointerId); } catch (err) {}
      dial.focus({ preventScroll: true });
      e.preventDefault();
    });
    dial.addEventListener("pointermove", function (e) {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      if (!drag.moved) { drag.moved = true; dial.classList.add("is-dragging"); }
      var a = Math.max(-LIMIT, Math.min(LIMIT, pointerAngle(e)));
      drag.angle = a;
      paint(a);
    });
    function end(e) {
      if (!drag) return;
      var d = drag;
      drag = null;
      dial.classList.remove("is-dragging");
      try { dial.releasePointerCapture(e.pointerId); } catch (err) {}
      if (!d.moved) { set((value + 1) % n, true); return; }
      var nearest = Math.round((d.angle - start) / SWEEP);
      if (nearest === value) { paint(angleOf(value)); pulse(); }
      else set(nearest, true);
    }
    dial.addEventListener("pointerup", end);
    dial.addEventListener("pointercancel", end);

    set(value, false);
    return { set: set, get: function () { return value; } };
  }

  window.AtlasKnob = { create: create };
})();
