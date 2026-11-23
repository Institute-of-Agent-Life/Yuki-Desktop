"""Apple's HIG discs beside ours: montages, edge close-ups and the measured numbers."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import measure, edge_sigma

S = os.environ['LAB_DIR']
APPLE = S + '/apple-dl/hig/img/materials-ios-liquid-glass-{}@2x.png'
IMAGES = ['over-light', 'over-dark', 'clear']
font = ImageFont.load_default(size=16)

def metrics(path):
    img = measure.load(path)
    L3 = measure.lab(img)
    c, R = (232.5, 232.5), 157.0
    r, inside, outside = measure.masks(L3.shape[:2], c, R)
    def stat(m):
        return dict(L=float(L3[..., 0][m].mean()), C=float(np.hypot(L3[..., 1], L3[..., 2])[m].mean()),
                    a=float(L3[..., 1][m].mean()), b=float(L3[..., 2][m].mean()))
    i, o = stat(inside), stat(outside)
    out = {'L_in': i['L'], 'dL': i['L'] - o['L'], 'C_ratio': i['C'] / max(o['C'], 1e-6),
           'db': i['b'] - o['b'], 'blur_edge_px2x': edge_sigma.edge_sigma(L3[..., 0], inside)}
    for name, angle in (('TL', 225), ('BR', 45), ('L', 180), ('B', 90)):
        p = measure.radial(L3, img, c, R, angle)
        d = np.array(p['d']); L = np.array(p['L']); rb = np.array(p['RB'])
        interior = L[(d >= -12) & (d <= -8)].mean()
        exterior = L[(d >= 6) & (d <= 12)].mean()
        rim = (d >= -4) & (d <= 0)
        k = np.argmax(L[rim]); peak = L[rim][k]
        half = interior + (peak - interior) / 2
        width = float((L[(d >= -8) & (d <= 0)] > half).sum() * 0.5)
        outline = L[(d >= 0.5) & (d <= 2)].min() - exterior
        out[f'rim_{name}'] = float(peak - interior)
        out[f'rimAt_{name}'] = float(d[rim][k])
        out[f'rimW_{name}'] = width
        out[f'outline_{name}'] = float(outline)
        out[f'fringe_{name}'] = float(np.abs(rb[(d >= -6) & (d <= 0)] - rb[(d >= -12) & (d <= -8)].mean()).max())
    return out

def montage(paths, labels, out, zoom=False):
    ims = [Image.open(p).convert('RGB') for p in paths]
    if zoom:
        # the upper-left rim, 48 px of the 2x image around 225°, enlarged 6x without smoothing
        cx = cy = 232.5 - 157 * np.sqrt(0.5)
        ims = [im.crop((int(cx - 24), int(cy - 24), int(cx + 24), int(cy + 24))).resize((288, 288), Image.NEAREST) for im in ims]
    w, h = ims[0].size
    canvas = Image.new('RGB', (len(ims) * (w + 10), h + 28), 'white')
    draw = ImageDraw.Draw(canvas)
    for k, (im, label) in enumerate(zip(ims, labels)):
        canvas.paste(im, (k * (w + 10), 28))
        draw.text((k * (w + 10) + 4, 4), label, fill='black', font=font)
    canvas.save(out)

if __name__ == '__main__':
    rnd, looks = sys.argv[1], sys.argv[2].split(',')
    table = {}
    for image in IMAGES:
        paths = [APPLE.format(image)] + [f'{rnd}/{look}-{image}.png' for look in looks]
        labels = ['Apple (HIG)'] + looks
        montage(paths, labels, f'{rnd}/side-{image}.png')
        montage(paths, labels, f'{rnd}/edge-{image}.png', zoom=True)
        table[image] = {label: metrics(p) for label, p in zip(labels, paths)}
    json.dump(table, open(f'{rnd}/metrics.json', 'w'), indent=1)
    keys = ['L_in', 'dL', 'C_ratio', 'db', 'blur_edge_px2x', 'rim_TL', 'rim_BR', 'rim_L', 'rim_B', 'rimAt_TL', 'rimW_TL', 'outline_TL', 'outline_BR', 'fringe_TL']
    for image in IMAGES:
        print(f'## {image}')
        print('| metric | ' + ' | '.join(table[image]) + ' |')
        for key in keys:
            print(f'| {key} | ' + ' | '.join(f'{table[image][l][key]:.2f}' for l in table[image]) + ' |')
