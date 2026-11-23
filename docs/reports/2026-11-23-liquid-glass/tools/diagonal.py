"""The glass's own light: L*(glass) - L*(background) along a diagonal through its centre."""
import numpy as np
from scipy import ndimage

def diagonal(L_glass, L_bg, centre, R, angle_deg=45, step=1.0, smooth=3):
    """From the upper-left rim (s = -1) through the centre to the lower-right rim (s = +1)."""
    a = np.deg2rad(angle_deg)
    ux, uy = np.cos(a), np.sin(a)  # 45° points down-right in image coordinates
    s = np.arange(-R - 12, R + 12.01, step)
    ys, xs = centre[0] + s * uy, centre[1] + s * ux
    g = ndimage.map_coordinates(ndimage.gaussian_filter(L_glass, smooth), [ys, xs], order=1)
    b = ndimage.map_coordinates(ndimage.gaussian_filter(L_bg, smooth), [ys, xs], order=1)
    return s / R, g - b, g
