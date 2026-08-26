/* The smallest thing that shows what the engine does: load a cloud, let the
   mouse move it, drop a pin where you click, and fly into a pin when you
   click it. About sixty lines, no build step, no framework. */
(function () {
  'use strict';

  var NEAR = './scan-near.bin';       // made by tools/ply_to_chpc.py
  var FULL = './scan-full.bin';

  var canvas = document.getElementById('c');
  var layer = document.getElementById('pins');
  var note = document.getElementById('note');
  var pins = [], dirty = true, viewer;

  try {
    viewer = new CommonsCloud.Viewer(canvas);
  } catch (e) {
    note.textContent = e.message;
    return;
  }
  function mark() { dirty = true; }
  CommonsCloud.controls(viewer, mark);

  function drawPins() {
    layer.innerHTML = pins.map(function (p, i) {
      var s = viewer.project(p);
      if (!s || s.x < -40 || s.y < -40) return '';
      return '<button class="pin" data-i="' + i + '" style="left:' + s.x + 'px;top:' + s.y + 'px">' +
             '<i></i>pin ' + (i + 1) + '</button>';
    }).join('');
    layer.querySelectorAll('.pin').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var p = pins[+b.dataset.i];
        // Fly in and keep only what is within six metres of the pin.
        viewer.flyTo({ target: p, radius: 9, phi: 1.25, focus: p, focusR: 6 }, mark, mark);
      });
    });
  }

  (function loop() {
    if (dirty && viewer.hasCloud()) { viewer.draw(); drawPins(); dirty = false; }
    requestAnimationFrame(loop);
  })();

  canvas._onTap = function (e, drag) {
    if (!drag || drag.moved > 6) return;         // a drag is not a click
    var r = canvas.getBoundingClientRect();
    var hit = viewer.pick(e.clientX - r.left, e.clientY - r.top, 18);
    if (!hit) { note.textContent = 'nothing there'; return; }
    pins.push(hit);
    note.textContent = hit.map(function (n) { return n.toFixed(2); }).join(', ') + ' m';
    mark();
  };

  document.getElementById('home').addEventListener('click', function () {
    viewer.frame();
    viewer.flyTo({ theta: -0.95, phi: 1.02, radius: viewer.radius,
                   target: viewer.target.slice(), focusR: 0 }, mark, mark);
  });
  document.getElementById('clear').addEventListener('click', function () {
    pins = []; mark();
  });

  (async function () {
    try {
      viewer.load(await CommonsCloud.fetch(NEAR));
      viewer.frame(); mark();
      note.textContent = 'sharpening…';
      viewer.load(await CommonsCloud.fetch(FULL, function (f) {
        note.textContent = 'sharpening… ' + Math.round(f * 100) + '%';
      }));
      mark();
      note.textContent = 'click the building';
    } catch (e) {
      note.textContent = 'no scan here yet. run tools/ply_to_chpc.py and put ' +
        'scan-near.bin and scan-full.bin in this folder.';
    }
  })();
})();
