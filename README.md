# commons-spatial

A laser scan of a building, in a browser, in twelve kilobytes of JavaScript
and no dependencies. Turn it, fly into a room, click a wall and get the
coordinate you clicked.

Built at the Commons Hub for the Valley of the Commons, where it is used to
pin jobs onto the building they belong to. The scan is Jeff Emmett's Leica
survey of the Hirschwangerhof: 1.9 million measured points, interiors
included.

```
viewer/cloud.js        the engine, ~12 KB, WebGL2, zero dependencies
format/CHPC.md         the point cloud format, implementable in an afternoon
tools/ply_to_chpc.py   PLY in, two levels of detail out
example/               a standalone page, no build step
```

## Why not Three.js

Nothing against it. Two reasons it is not here:

1. The site this came from runs `script-src 'self'`, so a CDN is not an
   option, and vendoring Three.js adds roughly 600 KB to pages that cost 14 to
   18 KB.
2. A point cloud is one draw call. No scene graph, no lighting, no materials.
   Everything a library would do here is arithmetic you need anyway to work
   out which point is under the cursor.

If you already have Three.js in your project, read `format/CHPC.md` and load
the buffers straight into a `BufferGeometry`. The format is the useful part;
the viewer is a reference implementation.

## Quick start

```bash
python3 tools/ply_to_chpc.py scan.ply --out ./         # makes near + full
python3 -m http.server -d example 8000
```

Then open `localhost:8000`. There is no build step and nothing to install
beyond numpy and cwebp-free Python.

To try it against the Hirschwangerhof, take the PLY from
[Jeff-Emmett/commons-hub-3d](https://github.com/Jeff-Emmett/commons-hub-3d)
and run it through the converter. That scan is not redistributed here: it
declares no licence, so ask before copying it around.

## What the viewer does

```js
const cloud = await CommonsCloud.fetch('/scan-full.bin', f => console.log(f));
const v = new CommonsCloud.Viewer(canvas);
v.load(cloud); v.frame();
CommonsCloud.controls(v, () => v.draw());
v.draw();
```

**Picking.** `v.pick(px, py, radius)` returns the world coordinate under the
cursor, or null. It projects every point and takes the nearest to the camera
inside the radius, ties broken by distance to the cursor. Two passes, because
doing it in one lets a point behind the wall win for being a pixel closer to
the click, which is how you end up pinning something to the far side of a
building. Measured: within half a metre of the surface you clicked, at any
zoom, on a 650k cloud in a few milliseconds.

**Flying.** `v.flyTo({target, radius, phi, focus, focusR})` eases the camera
over about a second. Anything that touches the canvas cancels it immediately:
an animation that fights the hand is worse than no animation.

**Focus.** Set `focus` to a point and `focusR` to a radius and everything
further away fades out over two and a half metres. That is what makes going
into a room feel like walking in rather than like a slide changing. A hard
clip reads as the model ending; a soft one reads as the wall of the room you
are in.

**Pins** are HTML positioned over the canvas by `v.project(worldPoint)`, not
geometry inside it. They keep your CSS, they stay crisp at any zoom, and they
are real buttons a keyboard can reach.

## What it is not

- Not a mesh renderer. Points only.
- Not a physics or collision layer. `pick` is the only spatial query.
- Not tiled or streamed. Two levels of detail, both loaded whole. Beyond a
  few million points you want an octree and this is not it.

## Licence

MIT, except the scan. See LICENSE.
