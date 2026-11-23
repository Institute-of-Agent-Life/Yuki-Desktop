"""Track a straight grid line through Apple's lens and fit our bevel (width, bend, profile) to it."""
import numpy as np
from scipy import ndimage, optimize

def track(L, x0, rows, window=40):
    """x of the dark vertical line in each row, following it from the first row."""
    xs, x = [], x0
    for y in rows:
        lo, hi = int(x - window), int(x + window)
        seg = ndimage.gaussian_filter1d(L[y, lo:hi], 1.0)
        base = ndimage.uniform_filter1d(seg, 15)
        k = int(np.argmin(seg - base))
        x = lo + k
        xs.append(x)
    return np.array(xs, float)

def snell(t):
    t = np.clip(t, 0, 1)
    sine = 1 - t
    dev = np.arcsin(sine) - np.arcsin(sine / 1.5)
    return np.where(t >= 1, 0, np.tan(dev) / np.tan(np.arcsin(1) - np.arcsin(1 / 1.5)))

def power(t, p):
    return np.where(t >= 1, 0, (1 - np.clip(t, 0, 1)) ** p)

def simulate(c, R, b, B, rows, line_x, profile):
    """Where our map shows the line x = line_x, row by row (inward sampling along the normal)."""
    xs = np.linspace(c[1] - R + 0.5, c[1], 4000)
    out = []
    for y in rows:
        dy = y - c[0]
        if abs(dy) >= R:
            out.append(np.nan); continue
        dx = xs - c[1]
        r = np.hypot(dx, dy)
        ok = r < R
        t = (R - r) / b
        amount = profile(t)
        sx = xs - (dx / np.maximum(r, 1e-9)) * B * amount
        diff = np.where(ok, sx - line_x, np.nan)
        k = np.nanargmin(np.abs(diff))
        out.append(xs[k] if abs(diff[k]) < 2 else np.nan)
    return np.array(out)
