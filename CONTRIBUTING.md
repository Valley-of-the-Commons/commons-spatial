# Adding to this

## Getting it running

```bash
python3 tools/ply_to_chpc.py your-scan.ply --out example/
python3 -m http.server -d example 8000
```

No build step, no package manager, no framework. `viewer/cloud.js` is a plain
script that defines `window.CommonsCloud`. If your project has a bundler it
will bundle; if it does not, a `<script src>` works.

For the Hirschwangerhof scan, take the PLY from
[Jeff-Emmett/commons-hub-3d](https://github.com/Jeff-Emmett/commons-hub-3d).
It is not copied into this repo because it declares no licence.

## Where a hand would go furthest

Read `SPEC.md` §6 first: four places where a week of work changes what
everything else can do, and none of them are claimed. In this repo
specifically:

- **A first-person walk.** Flying between anchors works; walking does not.
  The cloud has no surfaces, so you either mesh the floor or sample a ground
  height under the camera.
- **Tiling.** Both levels load whole. An octree with view-dependent loading is
  the honest fix past a few million points.
- **A reader for another engine.** Godot, Unity, Bevy, three.js. The format is
  in `format/CHPC.md` and is an afternoon's work. Link yours from the README
  rather than adding a dependency here.
- **Touch.** Pinch zoom works. Two-finger pan does not.

## What belongs somewhere else

Not a ranking of what matters. Three things live better outside this file:

- **Dependencies in `viewer/cloud.js`.** Twelve kilobytes and no imports is
  what makes it droppable into anything, including a page with a strict
  content policy. Build alongside it in your own file and the constraint stays
  useful to everyone.
- **The scan.** Jeff's to license, not this repo's to relicense.
- **Anything reaching a live service.** No keys, no endpoints, no project
  identifiers, so this stays safe for anyone to fork. The Hub's own instance
  holds people's names and recordings, which is why it is separate rather than
  secret. SPEC.md §2 says what it does, so you can build against it or build
  your own.

## Style

Match what is there, and change it where you have a better idea. Specifically:

- Comments say **why**, not what. If a line is surprising, the comment
  explains the constraint that made it that way.
- Name what you are unsure of. `sure: false` is better than a confident guess
  everywhere in this codebase.
- Prefer being obviously correct to being clever. The picking function is two
  passes rather than one because one pass was subtly wrong for a week.

## Before you open a pull request

Run it. Several of the worst bugs in this project passed review and failed the
first time somebody executed them. If you changed the format or the converter,
check that both levels still share an origin and a scale, because that is the
invariant that stops every pin jumping when the second file loads:

```bash
python3 - <<'PY'
import struct, numpy as np
def head(p):
    with open(p,'rb') as f:
        assert f.read(4)==b'CHPC'
        v,n = struct.unpack('<HI', f.read(6))
        return n, np.frombuffer(f.read(12),'<f4'), np.frombuffer(f.read(12),'<f4')
a, b = head('example/scan-near.bin'), head('example/scan-full.bin')
assert np.array_equal(a[1], b[1]) and np.array_equal(a[2], b[2]), 'levels do not share a frame'
print('ok:', a[0], 'and', b[0], 'points, same frame')
PY
```
