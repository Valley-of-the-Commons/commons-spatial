/* ══════════════════════════════════════════════════════════════════
   assets/cloud.js — the Hirschwangerhof, as measured points.

   Raw WebGL2 rather than Three.js, for two reasons and the second is the
   real one:

     · `script-src 'self'` means no CDN, and vendoring Three.js would add
       roughly 600 KB to pages that currently cost 14 to 18 KB against a
       120 KB budget.
     · A point cloud is one draw call. No scene graph, no lighting, no
       materials. Everything a library would do here is arithmetic we have to
       write down anyway to pick a point under the cursor.

   The data is Jeff Emmett's Leica scan, quantised to uint16 across the
   bounding box: 68 m over 65535 steps is about a millimetre, forty times
   finer than the 4.5 cm the scanner actually resolved. Two levels of detail,
   because the first thing anybody wants is to see the building, not to wait.

   Pins are HTML positioned over the canvas rather than geometry inside it.
   They inherit the styling the rest of the house already uses, they are real
   buttons a keyboard can reach, and their text stays crisp at every zoom
   instead of becoming a blurry texture.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++)
      for (var r = 0; r < 4; r++)
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[11] = -1;
    o[10] = (far + near) / (near - far);
    o[14] = (2 * far * near) / (near - far);
    return o;
  }
  var sub = function (a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; };
  var dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  var cross = function (a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  };
  function norm(a) {
    var l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  function lookAt(eye, at, up) {
    var z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
    ]);
  }

  var VERT = '#version 300 es\n' +
  'in uvec3 aQ;\n' +
  'in vec3 aRGB;\n' +
  'uniform mat4 uMVP;\n' +
  'uniform vec3 uOrigin, uScale, uFocus;\n' +
  'uniform float uSize, uDpr, uFocusR;\n' +
  'out vec3 vRGB;\n' +
  'out float vFade;\n' +
  'void main() {\n' +
  '  vec3 p = uOrigin + vec3(aQ) * uScale;\n' +
  '  vec4 clip = uMVP * vec4(p, 1.0);\n' +
  '  gl_Position = clip;\n' +
  '  float d = max(clip.w, 0.001);\n' +
  '  gl_PointSize = clamp(uSize * uDpr / d, 1.0 * uDpr, 9.0 * uDpr);\n' +
  '  vRGB = aRGB;\n' +
  '  vFade = clamp(1.0 - (d - 6.0) / 90.0, 0.35, 1.0);\n' +
  '  // Inside a room, the building around it fades out over a metre or two\n' +
  '  // rather than being cut with a hard edge, which reads as a wall of the\n' +
  '  // room rather than as the model ending.\n' +
  '  if (uFocusR > 0.0) {\n' +
  '    float away = distance(p, uFocus);\n' +
  '    vFade *= 1.0 - smoothstep(uFocusR, uFocusR + 2.5, away);\n' +
  '    if (away > uFocusR + 2.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);\n' +
  '  }\n' +
  '}';

  var FRAG = '#version 300 es\n' +
  'precision mediump float;\n' +
  'in vec3 vRGB;\n' +
  'in float vFade;\n' +
  'out vec4 fragColour;\n' +
  'void main() {\n' +
  '  vec2 d = gl_PointCoord - 0.5;\n' +
  '  if (dot(d, d) > 0.25) discard;\n' +
  '  vec3 c = pow(clamp(vRGB * 1.35 + 0.03, 0.0, 1.0), vec3(0.85));\n' +
  '  fragColour = vec4(c * vFade, 1.0);\n' +
  '}';

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  function parse(buf) {
    var dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'CHPC') {
      throw new Error('that is not a Commons Hub point cloud');
    }
    var count = dv.getUint32(6, true), o = 10;
    return {
      count: count,
      origin: [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)],
      scale:  [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)],
      q:   new Uint16Array(buf, o + 24, count * 3),
      rgb: new Uint8Array(buf, o + 24 + count * 6, count * 3)
    };
  }

  function Viewer(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('This browser cannot draw the scan. It needs WebGL2.');

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'aQ');
    gl.bindAttribLocation(prog, 1, 'aRGB');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));

    var U = {};
    ['uMVP','uOrigin','uScale','uSize','uDpr','uFocus','uFocusR'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    var vao = gl.createVertexArray(), bQ = gl.createBuffer(), bC = gl.createBuffer();
    var cloud = null, mvp = null, self = this;

    this.target = [0, 0, 0];
    this.theta = opts.theta !== undefined ? opts.theta : -0.95;
    this.phi   = opts.phi   !== undefined ? opts.phi   : 1.02;
    this.radius = opts.radius || 70;
    this.pointScale = 2.6;
    this.focus = null;            // [x,y,z] while inside a room
    this.focusR = 0;

    this.load = function (data) {
      cloud = data;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, bQ);
      gl.bufferData(gl.ARRAY_BUFFER, data.q, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribIPointer(0, 3, gl.UNSIGNED_SHORT, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bC);
      gl.bufferData(gl.ARRAY_BUFFER, data.rgb, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.bindVertexArray(null);
    };

    this.frame = function () {
      if (!cloud) return;
      var mn = cloud.origin;
      var mx = [mn[0] + cloud.scale[0] * 65535, mn[1] + cloud.scale[1] * 65535, mn[2] + cloud.scale[2] * 65535];
      self.target = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      self.radius = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * 0.6;
    };

    function eye() {
      var sp = Math.sin(self.phi);
      return [
        self.target[0] + self.radius * sp * Math.cos(self.theta),
        self.target[1] + self.radius * sp * Math.sin(self.theta),
        self.target[2] + self.radius * Math.cos(self.phi)
      ];
    }
    this.eye = eye;

    this.draw = function () {
      if (!cloud) return;
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.024, 0.039, 0.027, 1);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      mvp = mul(perspective(1.02, w / h, 0.25, 900), lookAt(eye(), self.target, [0, 0, 1]));

      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.uMVP, false, mvp);
      gl.uniform3fv(U.uOrigin, cloud.origin);
      gl.uniform3fv(U.uScale, cloud.scale);
      gl.uniform1f(U.uSize, self.pointScale * canvas.clientHeight / 6);
      gl.uniform1f(U.uDpr, dpr);
      gl.uniform3fv(U.uFocus, self.focus || [0, 0, 0]);
      gl.uniform1f(U.uFocusR, self.focus ? self.focusR : 0);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, cloud.count);
      gl.bindVertexArray(null);
    };

    this.project = function (p) {
      if (!mvp) return null;
      var x = mvp[0]*p[0] + mvp[4]*p[1] + mvp[8]*p[2] + mvp[12];
      var y = mvp[1]*p[0] + mvp[5]*p[1] + mvp[9]*p[2] + mvp[13];
      var w = mvp[3]*p[0] + mvp[7]*p[1] + mvp[11]*p[2] + mvp[15];
      if (w <= 0) return null;
      return { x: (x / w * 0.5 + 0.5) * canvas.clientWidth,
               y: (0.5 - y / w * 0.5) * canvas.clientHeight, d: w };
    };

    /* What is under the cursor. Rather than casting a ray and hunting for
       near misses, every point is projected and the nearest to the click
       within a few pixels wins, ties broken by depth. Same arithmetic the GPU
       just did, never misses a thin surface, a few milliseconds per click. */
    /* What is under the cursor.

       Two passes, and the reason is worth writing down: picking a surface has
       two objectives that fight each other, nearest to the camera and nearest
       to the cursor, and interleaving them in one loop lets a point behind the
       wall win because it happened to be a pixel closer to the click. Which
       means pinning a job to the far side of the building.

       So: gather everything inside the click radius, take the nearest depth
       among them, then among the ones at roughly that depth pick whichever is
       closest to the cursor. Front wall always beats back wall; ties go to
       where you actually clicked.

       Same arithmetic the GPU just did, so it never misses a thin surface,
       and a few milliseconds per click over 650k points. */
    this.pick = function (px, py, radiusPx) {
      if (!cloud || !mvp) return null;
      var R = radiusPx || 16, R2 = R * R;
      var o = cloud.origin, s = cloud.scale, q = cloud.q;
      var W = canvas.clientWidth, H = canvas.clientHeight;

      var idx = [], offs = [], deps = [], near = Infinity;
      for (var i = 0, n = cloud.count; i < n; i++) {
        var j = i * 3;
        var X = o[0] + q[j] * s[0], Y = o[1] + q[j+1] * s[1], Z = o[2] + q[j+2] * s[2];
        var w = mvp[3]*X + mvp[7]*Y + mvp[11]*Z + mvp[15];
        if (w <= 0.2) continue;
        var dx = ((mvp[0]*X + mvp[4]*Y + mvp[8]*Z + mvp[12]) / w * 0.5 + 0.5) * W - px;
        if (dx < -R || dx > R) continue;
        var dy = (0.5 - (mvp[1]*X + mvp[5]*Y + mvp[9]*Z + mvp[13]) / w * 0.5) * H - py;
        if (dy < -R || dy > R) continue;
        var off = dx*dx + dy*dy;
        if (off > R2) continue;
        idx.push(i); offs.push(off); deps.push(w);
        if (w < near) near = w;
      }
      if (!idx.length) return null;

      // A surface is not a plane at one exact depth: the scan puts points
      // within a voxel or two of it, and a wall seen at a glancing angle is
      // genuinely deep. So accept a slab behind the nearest hit, sized by the
      // scan's own resolution rather than by how far away the camera is.
      // Tying it to distance meant that standing back widened the tolerance
      // to over a metre, which is a lot of wall to be wrong about.
      var voxel = Math.max(s[0], s[1], s[2]) * 65535 / 400;   // ~ the sample spacing
      var slab = near + Math.max(0.30, voxel * 3);
      var best = -1, bestOff = Infinity;
      for (var k = 0; k < idx.length; k++) {
        if (deps[k] <= slab && offs[k] < bestOff) { bestOff = offs[k]; best = idx[k]; }
      }
      if (best < 0) return null;
      var m = best * 3;
      return [o[0] + q[m] * s[0], o[1] + q[m+1] * s[1], o[2] + q[m+2] * s[2]];
    };

    /* Going somewhere, rather than arriving. The camera eases from where it
       is to where it is going over about a second, and the focus radius opens
       and closes with it, so entering a room feels like walking in and not
       like a slide changing. Anybody who drags mid-flight takes over
       immediately: an animation that fights the hand is worse than none. */
    var flight = null;
    this.flyTo = function (opts, onFrame, onDone) {
      var from = { theta: self.theta, phi: self.phi, radius: self.radius,
                   target: self.target.slice(), focusR: self.focus ? self.focusR : 0 };
      var to = {
        theta: opts.theta !== undefined ? opts.theta : self.theta,
        phi: opts.phi !== undefined ? opts.phi : self.phi,
        radius: opts.radius !== undefined ? opts.radius : self.radius,
        target: opts.target || self.target.slice(),
        focusR: opts.focusR || 0,
      };
      if (opts.focus) self.focus = opts.focus;
      var ms = opts.ms || 950, t0 = null;

      function step(now) {
        if (!flight) return;
        if (t0 === null) t0 = now;
        var k = Math.min(1, (now - t0) / ms);
        var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // ease in out
        self.theta = from.theta + (to.theta - from.theta) * e;
        self.phi = from.phi + (to.phi - from.phi) * e;
        self.radius = from.radius + (to.radius - from.radius) * e;
        for (var i = 0; i < 3; i++) {
          self.target[i] = from.target[i] + (to.target[i] - from.target[i]) * e;
        }
        self.focusR = from.focusR + (to.focusR - from.focusR) * e;
        if (!to.focusR && k === 1) self.focus = null;
        if (onFrame) onFrame();
        if (k < 1) flight = requestAnimationFrame(step);
        else { flight = null; if (onDone) onDone(); }
      }
      cancelAnimationFrame(flight);
      flight = requestAnimationFrame(step);
    };
    this.stopFlight = function () { if (flight) { cancelAnimationFrame(flight); flight = null; } };

    this.canvas = canvas;
    this.hasCloud = function () { return !!cloud; };
  }

  function controls(v, onChange) {
    var el = v.canvas, drag = null, pointers = new Map(), pinch = 0;
    function takeOver() { if (v.stopFlight) v.stopFlight(); }
    function down(e) {
      takeOver();
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      pointers.set(e.pointerId, e);
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, moved: 0 };
    }
    function move(e) {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
      if (pointers.size === 2) {
        var p = Array.from(pointers.values());
        var dist = Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY);
        if (pinch) { v.radius = Math.max(2, Math.min(400, v.radius * (pinch / dist))); onChange(); }
        pinch = dist;
        return;
      }
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        var k = v.radius * 0.0016;
        var ct = Math.cos(v.theta), st = Math.sin(v.theta), cp = Math.cos(v.phi);
        v.target[0] += (st * dx + ct * cp * dy) * k;
        v.target[1] += (-ct * dx + st * cp * dy) * k;
        v.target[2] += Math.sin(v.phi) * dy * k;
      } else {
        v.theta -= dx * 0.006;
        v.phi = Math.max(0.06, Math.min(Math.PI - 0.06, v.phi - dy * 0.006));
      }
      onChange();
    }
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      var d = drag; drag = null;
      return d;
    }
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', function (e) { var d = up(e); if (el._onTap) el._onTap(e, d); });
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      takeOver();
      v.radius = Math.max(2, Math.min(400, v.radius * Math.exp(e.deltaY * 0.0011)));
      onChange();
    }, { passive: false });
  }

  global.CommonsCloud = {
    Viewer: Viewer, parse: parse, controls: controls,
    fetch: async function (url, onProgress) {
      var r = await fetch(url);
      if (!r.ok) throw new Error('The scan did not load (' + r.status + ').');
      if (!onProgress || !r.body) return parse(await r.arrayBuffer());
      var total = Number(r.headers.get('content-length')) || 0, got = 0, chunks = [];
      var reader = r.body.getReader();
      for (;;) {
        var s = await reader.read();
        if (s.done) break;
        chunks.push(s.value); got += s.value.length;
        if (total) onProgress(got / total);
      }
      var all = new Uint8Array(got), at = 0;
      chunks.forEach(function (c) { all.set(c, at); at += c.length; });
      return parse(all.buffer);
    }
  };
})(window);

/* ══════════════════════════════════════════════════════════════════
   A map pane: the same component whether the view is a photograph or the
   scan, so the house page and the renovation desk cannot drift apart.

   Both draw the same pins from the same table. What changes is only how a
   pin's stored numbers become a position on screen: a fraction of the frame
   for a picture, a projection through the camera for the cloud.
   ══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var CC = global.CommonsCloud;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /* opts: { view, pins(), onPinClick(slug), onPick(xyz), placing() } */
  CC.Pane = function (host, opts) {
    var view = opts.view || {};
    var wrap = document.createElement('div');
    wrap.className = 'mapwrap';
    host.innerHTML = '';
    host.appendChild(wrap);

    var layer = document.createElement('div');
    layer.className = 'pinlayer';

    var credit = document.createElement('div');
    credit.className = 'credit';
    credit.textContent = view.credit || '';

    var api = { destroy: function () {}, refresh: function () {} };

    /* ─── a photograph ───────────────────────────────────────────── */
    if (view.source !== 'pointcloud') {
      var img = document.createElement('img');
      img.alt = view.title || 'The house';
      img.src = view.url;
      img.addEventListener('error', function () {
        wrap.innerHTML = '<div style="padding:34px 20px;text-align:center">' +
          '<p class="muted" style="font-size:.9rem">That picture did not load. Everything below still works.</p></div>';
      });
      wrap.appendChild(img);
      wrap.appendChild(layer);
      wrap.appendChild(credit);

      api.refresh = function () {
        var pins = opts.pins() || [];
        layer.innerHTML = pins.filter(function (p) { return p.x != null; }).map(function (p) {
          return '<button class="pin' + (p.count ? ' has' : '') + (p.on ? ' on' : '') +
            '" type="button" data-place="' + esc(p.slug) + '"' +
            ' style="left:' + (p.x * 100) + '%;top:' + (p.y * 100) + '%">' +
            '<span class="dot"></span>' + esc(p.name) +
            (p.count ? ' <span class="n">' + p.count + '</span>' : '') + '</button>';
        }).join('');
      };
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest('[data-place]');
        if (b) return opts.onPinClick && opts.onPinClick(b.getAttribute('data-place'));
        if (!opts.onPick || !opts.placing || !opts.placing()) return;
        var r = wrap.getBoundingClientRect();
        opts.onPick([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, null]);
      });
      api.refresh();
      return api;
    }

    /* ─── the scan ───────────────────────────────────────────────── */
    var canvas = document.createElement('canvas');
    canvas.className = 'cloudcanvas';
    var note = document.createElement('div');
    note.className = 'cloudnote';
    note.textContent = 'Loading the scan…';
    wrap.appendChild(canvas);
    wrap.appendChild(layer);
    wrap.appendChild(note);
    wrap.appendChild(credit);

    var viewer, dirty = true, raf = 0, alive = true;
    try {
      viewer = new CC.Viewer(canvas);
    } catch (e) {
      wrap.innerHTML = '<div style="padding:34px 20px;text-align:center">' +
        '<p class="muted" style="font-size:.9rem">' + esc(e.message) +
        ' The photograph still works: switch views above.</p></div>';
      return api;
    }

    function mark() { dirty = true; }
    CC.controls(viewer, mark);

    function placePins() {
      var pins = opts.pins() || [];
      var html = '';
      pins.forEach(function (p) {
        if (p.x == null || p.z == null) return;
        var s = viewer.project([Number(p.x), Number(p.y), Number(p.z)]);
        if (!s) return;
        if (s.x < -60 || s.y < -40 || s.x > canvas.clientWidth + 60 || s.y > canvas.clientHeight + 40) return;
        html += '<button class="pin ' + esc(p.kind || 'place') +
          (p.count ? ' has' : '') + (p.on ? ' on in' : '') +
          (p.priority ? ' p-' + esc(p.priority) : '') +
          '" type="button" data-place="' + esc(p.slug) + '"' +
          ' style="left:' + s.x + 'px;top:' + s.y + 'px">' +
          '<span class="dot"></span>' + esc(p.name) +
          (p.count ? ' <span class="n">' + p.count + '</span>' : '') + '</button>';
      });
      layer.innerHTML = html;
    }

    function loop() {
      if (!alive) return;
      if (dirty && viewer.hasCloud()) { viewer.draw(); placePins(); dirty = false; }
      raf = requestAnimationFrame(loop);
    }

    layer.addEventListener('click', function (e) {
      var b = e.target.closest('[data-place]');
      if (b && opts.onPinClick) { e.stopPropagation(); opts.onPinClick(b.getAttribute('data-place')); }
    });

    /* A click that moved the camera is a drag, not a click. Without this,
       letting go after orbiting drops a pin wherever you happened to stop. */
    canvas._onTap = function (e, drag) {
      if (!drag || drag.moved > 6) return;
      if (!opts.onPick || !opts.placing || !opts.placing()) return;
      var r = canvas.getBoundingClientRect();
      var hit = viewer.pick(e.clientX - r.left, e.clientY - r.top, 18);
      if (hit) opts.onPick(hit);
      else note.textContent = 'Nothing there to pin. Aim at the building.';
    };

    api.refresh = function () { mark(); };
    api.destroy = function () { alive = false; if (viewer.stopFlight) viewer.stopFlight(); cancelAnimationFrame(raf); };
    api.viewer = viewer;

    /* Fly somewhere and keep the pins following the camera the whole way. */
    api.flyTo = function (opts, onDone) {
      viewer.flyTo(opts, mark, function () { mark(); if (onDone) onDone(); });
    };
    api.home = function (onDone) {
      viewer.frame();
      viewer.flyTo({ theta: -0.95, phi: 1.02, radius: viewer.radius, target: viewer.target.slice(), focusR: 0 },
        mark, function () { mark(); if (onDone) onDone(); });
    };

    (async function () {
      try {
        // The small one first so the building appears in about a second, then
        // the real one underneath it. Waiting six megabytes to see anything is
        // how a map gets called broken.
        var near = await CC.fetch(view.near || '/assets/house/cloud/hof-near.bin');
        if (!alive) return;
        viewer.load(near); viewer.frame(); mark(); loop();
        note.textContent = 'Sharpening…';
        var full = await CC.fetch(view.url, function (f) {
          note.textContent = 'Sharpening… ' + Math.round(f * 100) + '%';
        });
        if (!alive) return;
        viewer.load(full); mark();
        note.textContent = '';
        note.classList.add('gone');
      } catch (e) {
        note.textContent = e.message;
      }
    })();

    return api;
  };
})(window);
