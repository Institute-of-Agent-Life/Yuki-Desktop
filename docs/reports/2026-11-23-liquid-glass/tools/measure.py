"""Quantify a glass disc in an image: geometry, blur, colour, rim profile, dispersion, scale."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

def load(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float64) / 255.0

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def lab(img):
    lin = srgb_to_linear(img)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)

def find_disc(img, guess=None, radii=(120, 180)):
    """Centre and radius maximising the luminance gradient along the circle."""
    L = lab(img)[..., 0]
    gy, gx = np.gradient(ndimage.gaussian_filter(L, 0.7))
    g = np.hypot(gx, gy)
    h, w = L.shape
    cy0, cx0 = guess or (h / 2, w / 2)
    theta = np.linspace(0, 2 * np.pi, 720, endpoint=False)
    best = (0, None)
    for cy in np.arange(cy0 - 6, cy0 + 6.1, 1):
        for cx in np.arange(cx0 - 6, cx0 + 6.1, 1):
            for r in np.arange(radii[0], radii[1], 1):
                ys, xs = cy + r * np.sin(theta), cx + r * np.cos(theta)
                ok = (ys >= 0) & (ys < h - 1) & (xs >= 0) & (xs < w - 1)
                v = ndimage.map_coordinates(g, [ys[ok], xs[ok]], order=1).mean()
                if v > best[0]:
                    best = (v, (cy, cx, r))
    cy, cx, r = best[1]
    # refine to half a pixel
    for _ in range(2):
        cands = []
        for dy in (-0.5, 0, 0.5):
            for dx in (-0.5, 0, 0.5):
                for dr in (-0.5, 0, 0.5):
                    ys, xs = cy + dy + (r + dr) * np.sin(theta), cx + dx + (r + dr) * np.cos(theta)
                    ok = (ys >= 0) & (ys < h - 1) & (xs >= 0) & (xs < w - 1)
                    cands.append((ndimage.map_coordinates(g, [ys[ok], xs[ok]], order=1).mean(), (cy + dy, cx + dx, r + dr)))
        cy, cx, r = max(cands)[1]
    return cy, cx, r

def radial(img_lab, rgb, c, R, angle, span=30, d=np.arange(-16, 16.01, 0.5)):
    """Mean L*, chroma and R-B along the normal, d < 0 inside, over a sector of ±span degrees."""
    cy, cx = c
    theta = np.deg2rad(np.arange(angle - span, angle + span + 0.1, 1.0))
    out = {'d': d.tolist(), 'L': [], 'C': [], 'RB': []}
    for di in d:
        ys, xs = cy + (R + di) * np.sin(theta), cx + (R + di) * np.cos(theta)
        L = ndimage.map_coordinates(img_lab[..., 0], [ys, xs], order=1, mode='nearest')
        a = ndimage.map_coordinates(img_lab[..., 1], [ys, xs], order=1, mode='nearest')
        b = ndimage.map_coordinates(img_lab[..., 2], [ys, xs], order=1, mode='nearest')
        r_ = ndimage.map_coordinates(rgb[..., 0], [ys, xs], order=1, mode='nearest')
        b_ = ndimage.map_coordinates(rgb[..., 2], [ys, xs], order=1, mode='nearest')
        out['L'].append(float(L.mean())); out['C'].append(float(np.hypot(a, b).mean()))
        out['RB'].append(float((r_ - b_).mean()))
    return out

def masks(shape, c, R):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(yy - c[0], xx - c[1])
    return r, r < R * 0.8, (r > R + 10) & (r < R + 60)

def texture_ratio(L, mask):
    gy, gx = np.gradient(L)
    return float((gx[mask] ** 2 + gy[mask] ** 2).mean() / max(1e-9, L[mask].var()))

def equivalent_blur(L_ref, ref_mask, target_ratio, scale=1.0):
    """Gaussian sigma (in image px) that brings the reference texture to the target ratio."""
    best = None
    for s in np.arange(0, 40.01, 0.25):
        Lb = ndimage.gaussian_filter(L_ref, s) if s else L_ref
        v = texture_ratio(Lb, ref_mask)
        if best is None or abs(np.log(v + 1e-12) - np.log(target_ratio + 1e-12)) < best[1]:
            best = (s, abs(np.log(v + 1e-12) - np.log(target_ratio + 1e-12)))
    return float(best[0] / scale)

def dominant_period(L, mask):
    """Mean spatial period from the radially averaged power spectrum of a masked patch."""
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    side = min(y1 - y0, x1 - x0)
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    patch = L[cy - side // 2: cy + side // 2, cx - side // 2: cx + side // 2]
    patch = (patch - patch.mean()) * np.outer(np.hanning(patch.shape[0]), np.hanning(patch.shape[1]))
    P = np.abs(np.fft.fftshift(np.fft.fft2(patch))) ** 2
    n = patch.shape[0]
    yy, xx = np.mgrid[0:n, 0:n] - n // 2
    f = np.hypot(yy, xx) / n
    band = (f > 2 / n) & (f < 0.25)
    return float(1 / ((P[band] * f[band]).sum() / P[band].sum()))

def measure(glass_path, background_path=None, guess=None, radii=(120, 180)):
    img = load(glass_path)
    L3 = lab(img)
    c0 = find_disc(img, guess, radii)
    c, R = (c0[0], c0[1]), c0[2]
    r, inside, outside = masks(L3.shape[:2], c, R)
    outside &= (r < min(L3.shape[:2]))
    res = {'centre': [round(float(c[0]), 1), round(float(c[1]), 1)], 'radius': round(float(R), 1)}
    for name, m in (('inside', inside), ('outside', outside)):
        res[name] = {
            'L': round(float(L3[..., 0][m].mean()), 2),
            'a': round(float(L3[..., 1][m].mean()), 2),
            'b': round(float(L3[..., 2][m].mean()), 2),
            'C': round(float(np.hypot(L3[..., 1], L3[..., 2])[m].mean()), 2),
            'Lstd': round(float(L3[..., 0][m].std()), 2),
            'texture': round(texture_ratio(L3[..., 0], m), 5),
        }
    if background_path:
        bg = lab(load(background_path))[..., 0]
        res['blurSigmaPx'] = equivalent_blur(bg, inside, res['inside']['texture'])
        res['background_inside'] = {
            'L': round(float(bg[inside].mean()), 2),
            'texture': round(texture_ratio(bg, inside), 5),
        }
    res['profiles'] = {name: radial(L3, img, c, R, angle) for name, angle in
                       (('topLeft', 225), ('top', 270), ('right', 0), ('bottomRight', 45), ('bottom', 90), ('left', 180))}
    try:
        res['period'] = {'inside': round(dominant_period(L3[..., 0], inside), 2),
                         'outside_ring': None}
    except Exception:
        pass
    return res

if __name__ == '__main__':
    out = measure(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '-' else None)
    print(json.dumps(out))
