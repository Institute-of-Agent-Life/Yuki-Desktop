"""Infer the lens's displacement field from its grid lines: predict where each grid line shows
through a radial field (sampling inward or outward along the normal), and score the prediction
against the traced lines with a symmetric chamfer distance."""
import numpy as np
from scipy import ndimage

def predict(shape, centre, R, box, D_of_d, sign, vertical, horizontal, width=0.9):
    y0, y1, x0, x1 = box
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(float)
    dy, dx = yy - centre[0], xx - centre[1]
    r = np.hypot(dx, dy)
    inside = r < R - 1.5
    d = R - r
    nx, ny = dx / np.maximum(r, 1e-9), dy / np.maximum(r, 1e-9)
    D = D_of_d(d)
    # sign +1: the pixel shows the background further out; -1: further in
    sx, sy = xx + sign * nx * D, yy + sign * ny * D
    line = np.zeros_like(r, bool)
    for X in vertical:
        line |= np.abs(sx - X) < width
    for Y in horizontal:
        line |= np.abs(sy - Y) < width
    return line & inside, inside

def chamfer(a, b, inside):
    if a.sum() == 0 or b.sum() == 0:
        return 1e9
    da = ndimage.distance_transform_edt(~a)
    db = ndimage.distance_transform_edt(~b)
    return float(0.5 * (db[a & inside].mean() + da[b & inside].mean()))

def fit(traced, centre, R, box, vertical, horizontal):
    results = []
    _, inside = predict(traced.shape, centre, R, box, lambda d: 0 * d, 1, vertical, horizontal)
    for sign in (-1, 1):
        for p in (1.0, 1.5, 2.0, 3.0):
            for b in np.arange(0.08, 0.61, 0.04):
                for m in np.arange(0.04, 0.61, 0.04):
                    D = lambda d, b=b, m=m, p=p: np.where(d < b * R, m * R * (1 - np.clip(d / (b * R), 0, 1)) ** p, 0)
                    pred, _ = predict(traced.shape, centre, R, box, D, sign, vertical, horizontal)
                    results.append((chamfer(pred, traced, inside), sign, p, round(b, 2), round(m, 2)))
    results.sort()
    return results
