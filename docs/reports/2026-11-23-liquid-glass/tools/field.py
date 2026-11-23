"""Measure a lens's radial displacement D(d) from grid lines seen through it.

Grid lines run straight outside; inside, a line pixel p at depth d from the edge (outward normal n)
shows the background point s = p - n * D(d). For a vertical line at x = X, D = (p.x - X) / n.x;
for a horizontal one at y = Y, D = (p.y - Y) / n.y. Each line pixel gives one sample of D(d)."""
import numpy as np
from scipy import ndimage

def ridges(L, inside, strength=1.2):
    """Thin dark lines: darker than their 9px neighbourhood by `strength` L*."""
    base = ndimage.median_filter(L, size=9)
    dark = (base - L) > strength
    return dark & inside

def samples(L, centre, R, vertical, horizontal, exclude_rim=1.5, strength=1.2):
    h, w = L.shape
    yy, xx = np.mgrid[0:h, 0:w]
    dy, dx = yy - centre[0], xx - centre[1]
    r = np.hypot(dx, dy)
    inside = r < R - exclude_rim
    mask = ridges(L, inside, strength)
    # cut the face's own crossings, so each component is one line
    for X in vertical:
        for Y in horizontal:
            mask &= ~((np.abs(xx - X) < 8) & (np.abs(yy - Y) < 8))
    labels, n = ndimage.label(mask, structure=np.ones((3, 3)))
    out = []
    for k in range(1, n + 1):
        ys, xs = np.where(labels == k)
        if len(ys) < 15:
            continue
        rr = r[ys, xs]
        crossings = [(X, Y) for X in vertical for Y in horizontal]
        near = [(np.hypot(xs - X, ys - Y).min(), X, Y) for X, Y in crossings]
        dist, X0, Y0 = min(near)
        if dist < 14:
            # an arm leaving a crossing: vertical if it runs more along y just past the crossing
            ring = (np.hypot(xs - X0, ys - Y0) > 12) & (np.hypot(xs - X0, ys - Y0) < 30)
            if ring.sum() < 3:
                continue
            vertical_arm = np.abs(ys[ring] - Y0).mean() > np.abs(xs[ring] - X0).mean()
            kind, at = ('v', X0) if vertical_arm else ('h', Y0)
        else:
            deep = (R - rr) > R * 0.3
            if deep.sum() < 5:
                continue
            cand = [('v', X, np.abs(xs[deep] - X).mean()) for X in vertical] +                    [('h', Y, np.abs(ys[deep] - Y).mean()) for Y in horizontal]
            kind, at, err = min(cand, key=lambda c: c[2])
            if err > 3:
                continue
        nx, ny = dx[ys, xs] / rr, dy[ys, xs] / rr
        if kind == 'v':
            ok = np.abs(nx) > 0.25
            D = (xs[ok] - at) / nx[ok]
        else:
            ok = np.abs(ny) > 0.25
            D = (ys[ok] - at) / ny[ok]
        d = R - rr[ok]
        out.append(np.stack([d, D], 1))
    return np.concatenate(out) if out else np.zeros((0, 2)), mask

def profile(points, R, bins=40, upto=0.45):
    edges = np.linspace(0, upto * R, bins + 1)
    mids, med, count = [], [], []
    for a, b in zip(edges[:-1], edges[1:]):
        sel = (points[:, 0] >= a) & (points[:, 0] < b)
        if sel.sum() >= 3:
            mids.append((a + b) / 2); med.append(float(np.median(points[sel, 1]))); count.append(int(sel.sum()))
    return np.array(mids), np.array(med), np.array(count)
