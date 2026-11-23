"""Gaussian sigma of the softest-looking edges in a region: contrast over steepest slope."""
import numpy as np
from scipy import ndimage

def edge_sigma(L, mask):
    Ls = ndimage.gaussian_filter(L, 0.8)
    gy, gx = np.gradient(Ls)
    g = np.hypot(gx, gy)[mask]
    contrast = np.percentile(L[mask], 97) - np.percentile(L[mask], 3)
    return float(contrast / (np.percentile(g, 99.7) * np.sqrt(2 * np.pi)))
