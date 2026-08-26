#!/usr/bin/env python3
"""
PLY in, CHPC out. Two levels of detail from one pass.

    python3 ply_to_chpc.py scan.ply --out ./
    python3 ply_to_chpc.py scan.ply --out ./ --levels 120000 650000

Why two levels: the small one paints the building in about a second and the
large one loads behind it. They are computed from ONE bounding box, so they
share an origin and a scale exactly. If they did not, everything pinned to the
cloud would jump the moment the second file swapped in.

Downsampling is by voxel rather than at random: keeping one point per occupied
cell preserves surfaces, while random sampling thins walls into fog. Within a
cell the point nearest its centre wins, so surfaces stay where they are instead
of drifting to a corner.

Only needs numpy.
"""
import argparse, struct, sys
import numpy as np


def read_ply(path):
    """Binary little-endian PLY with x,y,z and either uchar or float colour."""
    with open(path, 'rb') as f:
        if f.readline().strip() != b'ply':
            sys.exit('not a PLY file')
        fmt = count = None
        props = []
        while True:
            line = f.readline()
            if not line:
                sys.exit('PLY header never ended')
            parts = line.split()
            if not parts:
                continue
            if parts[0] == b'format':
                fmt = parts[1]
            elif parts[0] == b'element' and parts[1] == b'vertex':
                count = int(parts[2])
            elif parts[0] == b'property' and len(parts) == 3:
                props.append((parts[1].decode(), parts[2].decode()))
            elif parts[0] == b'end_header':
                break
        if fmt != b'binary_little_endian':
            sys.exit('only binary_little_endian PLY is supported; convert it first')

        TYPES = {'float': '<f4', 'float32': '<f4', 'double': '<f8',
                 'uchar': 'u1', 'uint8': 'u1', 'char': 'i1',
                 'int': '<i4', 'short': '<i2', 'ushort': '<u2'}
        dt = np.dtype([(name, TYPES[t]) for t, name in props])
        raw = np.frombuffer(f.read(count * dt.itemsize), dtype=dt, count=count)

    have = raw.dtype.names
    for axis in ('x', 'y', 'z'):
        if axis not in have:
            sys.exit('PLY has no %s property' % axis)
    xyz = np.stack([raw['x'], raw['y'], raw['z']], 1).astype(np.float64)

    names = [n for n in ('red', 'green', 'blue') if n in have]
    if len(names) == 3:
        rgb = np.stack([raw[n] for n in names], 1)
        if rgb.dtype.kind == 'f':                 # 0..1 floats
            rgb = np.clip(rgb * 255.0, 0, 255)
        rgb = rgb.astype(np.uint8)
    else:
        print('  no colour in this PLY, using flat grey')
        rgb = np.full((len(xyz), 3), 170, np.uint8)
    return xyz, rgb


def voxel(xyz, rgb, size, lo):
    key = np.floor((xyz - lo) / size).astype(np.int64)
    dim = key.max(0) + 1
    flat = key[:, 0] + dim[0] * (key[:, 1] + dim[1] * key[:, 2])
    centre = (key + 0.5) * size + lo
    d2 = ((xyz - centre) ** 2).sum(1)
    order = np.lexsort((d2, flat))
    fs = flat[order]
    first = np.ones(len(fs), bool)
    first[1:] = fs[1:] != fs[:-1]
    keep = order[first]
    return xyz[keep], rgb[keep]


def target_voxel(xyz, rgb, lo, target, rounds=28):
    """Binary search a voxel size that lands near `target` points."""
    small, large = 0.005, 8.0
    for _ in range(rounds):
        mid = (small * large) ** 0.5
        n = len(voxel(xyz, rgb, mid, lo)[0])
        if n > target:
            small = mid
        else:
            large = mid
    return large


def write(path, xyz, rgb, lo, scale):
    q = np.clip(np.round((xyz - lo) / scale), 0, 65535).astype('<u2')
    with open(path, 'wb') as f:
        f.write(b'CHPC')
        f.write(struct.pack('<HI', 1, len(xyz)))
        f.write(np.asarray(lo, '<f4').tobytes())
        f.write(np.asarray(scale, '<f4').tobytes())
        f.write(np.ascontiguousarray(q).tobytes())
        f.write(np.ascontiguousarray(rgb, 'u1').tobytes())


def main():
    ap = argparse.ArgumentParser(description='Turn a PLY point cloud into CHPC.')
    ap.add_argument('ply')
    ap.add_argument('--out', default='.', help='directory to write into')
    ap.add_argument('--name', default='scan', help='basename, default "scan"')
    ap.add_argument('--levels', type=int, nargs='+', default=[120_000, 650_000],
                    help='target point counts, small first')
    args = ap.parse_args()

    print('reading %s' % args.ply)
    xyz, rgb = read_ply(args.ply)
    lo, hi = xyz.min(0), xyz.max(0)
    span = hi - lo
    print('  %s points, bounding box %s m' % (f'{len(xyz):,}', np.round(span, 2)))

    # ONE bounding box for every level, so the files share a frame exactly.
    scale = (span / 65535.0).astype(np.float32)
    print('  %.2f mm per step' % (scale.max() * 1000))

    names = ['near', 'full'] if len(args.levels) == 2 else \
            ['lod%d' % i for i in range(len(args.levels))]

    import os
    for target, tag in zip(args.levels, names):
        size = target_voxel(xyz, rgb, lo, target)
        p, c = voxel(xyz, rgb, size, lo)
        path = os.path.join(args.out, '%s-%s.bin' % (args.name, tag))
        write(path, p, c, lo.astype(np.float32), scale)
        mb = os.path.getsize(path) / 1048576
        print('  %-18s %s points, %.1f cm voxel, %.2f MB' %
              (os.path.basename(path), f'{len(p):,}', size * 100, mb))


if __name__ == '__main__':
    main()
