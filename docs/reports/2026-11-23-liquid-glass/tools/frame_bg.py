"""Rebuild the background under a shape in a frame: rows and columns interpolated across it."""
import numpy as np
from PIL import Image

def rebuild(path, inside, out):
    im = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
    h, w, _ = im.shape
    rows = im.copy(); cols = im.copy()
    for y in range(h):
        xs = np.where(inside[y])[0]
        if len(xs):
            a, b = max(xs[0] - 2, 0), min(xs[-1] + 2, w - 1)
            t = (np.arange(a, b + 1) - a) / max(1, b - a)
            rows[y, a:b + 1] = im[y, a][None] * (1 - t)[:, None] + im[y, b][None] * t[:, None]
    for x in range(w):
        ys = np.where(inside[:, x])[0]
        if len(ys):
            a, b = max(ys[0] - 2, 0), min(ys[-1] + 2, h - 1)
            t = (np.arange(a, b + 1) - a) / max(1, b - a)
            cols[a:b + 1, x] = im[a, x][None] * (1 - t)[:, None] + im[b, x][None] * t[:, None]
    # lines survive in whichever direction runs along them; the smooth gradient is in both
    lum = lambda v: v @ np.array([0.2126, 0.7152, 0.0722])
    pick = (lum(rows) < lum(cols))[..., None]
    rebuilt = np.where(pick, rows, cols)
    Image.fromarray(np.clip(rebuilt, 0, 255).astype(np.uint8)).save(out)
