#!/usr/bin/env python3
"""Measure how pale a frame is, in numbers, so a target can be a delta.

Reports per frame, over the WORLD only (the HUD is excluded by a mask the
caller supplies, or by the --crop-hud default that drops the HUD's own bands):

  lumaMean/lumaStd  BT.709 luma, 0-255. lumaStd is global contrast.
  satMean/satP90    HSV saturation x255. "Pale" is low satMean.
  chromaMean        mean |a*|,|b*| in CIELAB - saturation that survives on dark pixels.
  p01/p50/p99       luma percentiles. A washed frame has a high p01 (no true black)
                    and a low p99 (no true white); p99-p01 is the used range.
  blackPct/whitePct pixels under 16 / over 239.
"""
import sys, json, argparse
import numpy as np
from PIL import Image

def srgb_to_linear(c):
    return np.where(c <= .04045, c/12.92, ((c+.055)/1.055)**2.4)

def lab(rgb):
    lin = srgb_to_linear(rgb)
    m = np.array([[.4124,.3576,.1805],[.2126,.7152,.0722],[.0193,.1192,.9505]])
    xyz = lin @ m.T / np.array([.95047,1.0,1.08883])
    f = np.where(xyz > .008856, np.cbrt(xyz), 7.787*xyz + 16/116)
    return np.stack([116*f[...,1]-16, 500*(f[...,0]-f[...,1]), 200*(f[...,1]-f[...,2])], -1)

def measure(path, crop_hud=True):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)/255.
    h, w = a.shape[:2]
    if crop_hud:
        # The world band: below the header, above the drive cluster, right of
        # the standing block. Measured from the shipped HUD anchors.
        a = a[int(.18*h):int(.62*h), int(.30*w):int(.97*w)]
    rgb = a.reshape(-1,3)
    luma = rgb @ np.array([.2126,.7152,.0722])
    mx, mn = rgb.max(1), rgb.min(1)
    sat = np.where(mx > 0, (mx-mn)/np.maximum(mx,1e-6), 0)
    L = lab(rgb)
    chroma = np.hypot(L[...,1], L[...,2])
    q = np.percentile(luma, [1,50,99])*255
    return {
        "frame": path.split("/")[-1],
        "lumaMean": round(float(luma.mean()*255),2),
        "lumaStd":  round(float(luma.std()*255),2),
        "satMean":  round(float(sat.mean()*255),2),
        "satP90":   round(float(np.percentile(sat,90)*255),2),
        "chromaMean": round(float(chroma.mean()),2),
        "p01": round(float(q[0]),1), "p50": round(float(q[1]),1), "p99": round(float(q[2]),1),
        "range": round(float(q[2]-q[0]),1),
        "blackPct": round(float((luma*255 < 16).mean()*100),2),
        "whitePct": round(float((luma*255 > 239).mean()*100),2),
    }

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("frames", nargs="+")
    p.add_argument("--full", action="store_true", help="measure the whole frame, HUD included")
    p.add_argument("--json", help="write rows here")
    args = p.parse_args()
    rows = [measure(f, crop_hud=not args.full) for f in args.frames]
    cols = ["frame","lumaMean","lumaStd","satMean","satP90","chromaMean","p01","p50","p99","range","blackPct","whitePct"]
    print(f'{"frame":38}' + "".join(f"{c:>11}" for c in cols[1:]))
    for r in rows:
        print(f'{r["frame"][:37]:38}' + "".join(f'{r[c]:>11}' for c in cols[1:]))
    if len(rows) > 1:
        print(f'{"MEAN":38}' + "".join(f'{round(float(np.mean([r[c] for r in rows])),2):>11}' for c in cols[1:]))
    if args.json:
        json.dump(rows, open(args.json,"w"), indent=2)
