"""Stand-in backgrounds for the HIG discs: Apple's photo outside the disc, and beneath it a mirror
tiling of the photo's four corners (the photo under the glass is not available). The ring 157.5 to
159.5 px is pulled from just outside, so Apple's own rim does not leak into ours."""
import os
import numpy as np
from PIL import Image

LAB = os.environ['LAB_DIR']
for name in ['over-light', 'over-dark', 'clear']:
    im = np.asarray(Image.open(f'{LAB}/apple-dl/hig/img/materials-ios-liquid-glass-{name}@2x.png').convert('RGB'))
    h, w, _ = im.shape
    p = 74
    def tile(patch, H, W, fy, fx):
        rows = []
        for i in range(-(-H // p)):
            row = []
            for j in range(-(-W // p)):
                t = patch[::-1] if i % 2 else patch
                row.append(t[:, ::-1] if j % 2 else t)
            rows.append(np.concatenate(row, 1))
        g = np.concatenate(rows, 0)
        if fy:
            g = g[::-1]
        if fx:
            g = g[:, ::-1]
        return g
    hh, hw = h // 2 + 1, w // 2 + 1
    out = np.zeros_like(im)
    out[:hh, :hw] = tile(im[:p, :p], hh, hw, 0, 0)[:hh, :hw]
    out[:hh, w - hw:] = tile(im[:p, -p:], hh, hw, 0, 1)[:hh, -hw:]
    out[h - hh:, :hw] = tile(im[-p:, :p], hh, hw, 1, 0)[-hh:, :hw]
    out[h - hh:, w - hw:] = tile(im[-p:, -p:], hh, hw, 1, 1)[-hh:, -hw:]
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(yy - 232.5, xx - 232.5)
    result = np.where((r < 157.5)[..., None], out, im)
    ring = (r >= 157.5) & (r < 159.5)
    ys, xs = np.where(ring)
    f = 161.5 / r[ring]
    result[ys, xs] = im[np.clip(np.round(232.5 + (ys - 232.5) * f).astype(int), 0, h - 1),
                        np.clip(np.round(232.5 + (xs - 232.5) * f).astype(int), 0, w - 1)]
    os.makedirs(f'{LAB}/liquid-glass/v3/backgrounds', exist_ok=True)
    Image.fromarray(result.astype(np.uint8)).save(f'{LAB}/liquid-glass/v3/backgrounds/{name}.png')
