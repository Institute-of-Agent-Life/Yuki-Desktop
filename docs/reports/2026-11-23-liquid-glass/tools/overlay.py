"""Both sides' grid lines traced and laid over each other: Apple red, ours blue, both purple."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

def trace(L, inside, strength=1.2):
    base = ndimage.median_filter(L, size=9)
    return ((base - L) > strength) & inside

def overlay(La, Lb, centre, R, box, out, zoom=2, label=('Apple', 'Yuki')):
    h, w = La.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(yy - centre[0], xx - centre[1])
    inside = r < R + 40
    a, b = trace(La, inside), trace(Lb, inside)
    img = np.full((h, w, 3), 255, np.uint8)
    img[a & ~b] = (220, 40, 40)
    img[b & ~a] = (40, 90, 230)
    img[a & b] = (120, 40, 150)
    edge = np.abs(r - R) < 0.7
    img[edge] = (150, 150, 150)
    im = Image.fromarray(img).crop(box)
    im = im.resize((im.width * zoom, im.height * zoom), Image.NEAREST)
    d = ImageDraw.Draw(im)
    font = ImageFont.load_default(size=22)
    d.text((8, 8), f'red: {label[0]}   blue: {label[1]}   purple: both   grey: glass edge', fill=(0, 0, 0), font=font)
    im.save(out)
