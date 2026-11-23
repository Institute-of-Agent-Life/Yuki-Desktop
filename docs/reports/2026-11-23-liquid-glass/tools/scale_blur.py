"""Fit magnification s and Gaussian blur sigma that turn the reference texture into the inside."""
import numpy as np
from scipy import ndimage

def radial_spectrum(p, bins):
    p = (p - p.mean()) * np.outer(np.hanning(p.shape[0]), np.hanning(p.shape[1]))
    P = np.abs(np.fft.fftshift(np.fft.fft2(p))) ** 2
    n = p.shape[0]
    yy, xx = np.mgrid[0:n, 0:n] - n // 2
    f = np.hypot(yy, xx) / n
    out = np.array([P[(f >= a) & (f < b)].mean() for a, b in zip(bins[:-1], bins[1:])])
    return np.log(out / out.sum() + 1e-12)

def fit(inside, reference, size=150):
    bins = np.linspace(0.008, 0.12, 15)
    target = radial_spectrum(inside, bins)
    best = None
    for s in np.arange(1.0, 1.81, 0.05):
        z = ndimage.zoom(reference, s, order=3)
        cy, cx = z.shape[0] // 2, z.shape[1] // 2
        z = z[cy - size // 2: cy + size // 2, cx - size // 2: cx + size // 2]
        for sigma in np.arange(0, 16.01, 0.5):
            v = radial_spectrum(ndimage.gaussian_filter(z, sigma) if sigma else z, bins)
            err = float(((v - target) ** 2).mean())
            if best is None or err < best[0]:
                best = (err, float(s), float(sigma))
    return best
