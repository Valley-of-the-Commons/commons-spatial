# CHPC — a point cloud a browser can open

A laser scan arrives as a 27 MB PLY of float32 coordinates. That is roughly a
thousand times more precision than a 4.5 cm scan actually carries, it needs a
parser, and it is hopeless on a phone in a valley with one bar.

CHPC is the same points with the fat removed: positions quantised to uint16
across the bounding box, colour at one byte per channel, laid out so each array
uploads straight to the GPU with no unpacking loop.

For the Hirschwangerhof that is **1.03 mm per step over 68 m** — forty times
finer than the scanner resolved — at about a fifth of the size.

## Layout

Little-endian throughout. No padding, no alignment tricks.

| offset | bytes | what |
|---|---|---|
| 0 | 4 | magic, ASCII `CHPC` |
| 4 | 2 | version, uint16, currently `1` |
| 6 | 4 | count, uint32 |
| 10 | 12 | origin x, y, z, float32 — the bounding box corner in metres |
| 22 | 12 | scale x, y, z, float32 — metres per quantisation step |
| 34 | count × 6 | positions, uint16 x, y, z, interleaved |
| 34 + count×6 | count × 3 | colours, uint8 r, g, b |

A point is:

```
world = origin + vec3(qx, qy, qz) * scale
```

`scale` is `(max - min) / 65535` per axis, so the quantisation error is half a
step. At Hirschwangerhof that is half a millimetre, which is invisible against
a scan whose own samples are 45 mm apart.

## Levels of detail

Ship two files from the same scan. The small one appears in about a second and
the large one loads behind it.

**They must share `origin` and `scale` exactly.** If they do not, everything
pinned to the cloud jumps the moment the second file swaps in, which reads as
the map being broken. `tools/ply_to_chpc.py` computes the bounding box once
from the full cloud and reuses it for every level, which is the whole reason
it does both in one pass rather than being run twice.

## Why not glTF, or Draco, or LAS

- **glTF** carries a scene graph, materials and animation. A point cloud has
  none of those. The wrapper would be larger than the payload.
- **Draco** compresses better and needs a decoder, which for the web means
  shipping WebAssembly. This format exists so that a viewer can be twelve
  kilobytes with no dependencies at all.
- **LAS/LAZ** is the right archival format and a poor delivery one. Keep the
  LAS. Serve CHPC.

If you want a compressed transport, gzip the file. The quantised data
compresses about 15% because the low bytes are close to random, which tells
you the quantisation is already doing most of the work.

## Reading it somewhere else

The format is deliberately small enough to implement in an afternoon.

```python
import numpy as np, struct
with open('scan.bin', 'rb') as f:
    assert f.read(4) == b'CHPC'
    version, count = struct.unpack('<HI', f.read(6))
    origin = np.frombuffer(f.read(12), '<f4')
    scale  = np.frombuffer(f.read(12), '<f4')
    q   = np.frombuffer(f.read(count * 6), '<u2').reshape(-1, 3)
    rgb = np.frombuffer(f.read(count * 3), 'u1').reshape(-1, 3)
xyz = origin + q * scale
```

In a game engine, `q` maps onto a uint16 vertex buffer directly and `origin`
and `scale` become two uniforms, exactly as in `viewer/cloud.js`. Nothing needs
converting on the CPU.

## Coordinate frame

Whatever the scanner produced. For the Hirschwangerhof, **z is up**, metres,
and the origin is arbitrary. The viewer is written for z up; if your scan is
y up, swap the axes in the converter rather than in the shader, so that
everything downstream agrees.
