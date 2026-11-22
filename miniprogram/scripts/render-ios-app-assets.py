#!/usr/bin/env python3
"""Render and check WeChat miniapp iOS icons + splash.

Source artwork: miniapp/ios/artwork/icon.html and splash.html
(seal geometry from docs/品牌专项/vis3/seal-standard-brass.svg).

Usage:
  python3 miniprogram/scripts/render-ios-app-assets.py
  python3 miniprogram/scripts/render-ios-app-assets.py --check
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "miniapp" / "ios" / "artwork"
ICON_DIR = ROOT / "miniapp" / "ios" / "icons"
SPLASH_PATH = ROOT / "miniapp" / "ios" / "splash" / "launch.png"

# Field name → pixel size. Matches project.miniapp.json mini-ios.icons.
ICON_SIZES = {
    "mainIcon120": 120,
    "mainIcon180": 180,
    "spotlightIcon80": 80,
    "spotlightIcon120": 120,
    "settingsIcon58": 58,
    "settingsIcon87": 87,
    "notificationIcon40": 40,
    "notificationIcon60": 60,
    "appStore1024": 1024,
}

SPLASH_SIZE = (1125, 2436)
CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
]


def chrome_bin() -> str:
    for path in CHROME_CANDIDATES:
        if Path(path).is_file():
            return path
    raise SystemExit("需要本机 Google Chrome 才能重绘图标。已提交的 PNG 可用 --check 校验。")


def shoot(html: Path, out: Path, width: int, height: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        chrome_bin(),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        f"--window-size={width},{height}",
        f"--screenshot={out}",
        html.as_uri(),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    img = Image.open(out).convert("RGB")
    if img.size != (width, height):
        img = img.resize((width, height), Image.Resampling.LANCZOS)
    img.save(out, "PNG", optimize=True)


def render() -> None:
    master = ART / "_master-1024.png"
    shoot(ART / "icon.html", master, 1024, 1024)
    base = Image.open(master).convert("RGB")
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for name, size in ICON_SIZES.items():
        img = base if size == 1024 else base.resize((size, size), Image.Resampling.LANCZOS)
        img.save(ICON_DIR / f"{name}.png", "PNG", optimize=True)
    shoot(ART / "splash.html", SPLASH_PATH, *SPLASH_SIZE)
    master.unlink(missing_ok=True)
    check()


def check() -> None:
    errors = []
    for name, size in ICON_SIZES.items():
        path = ICON_DIR / f"{name}.png"
        if not path.is_file():
            errors.append(f"缺少 {path.relative_to(ROOT)}")
            continue
        img = Image.open(path)
        if img.size != (size, size):
            errors.append(f"{name} 尺寸 {img.size}，应为 {(size, size)}")
        if name == "appStore1024" and img.mode in ("RGBA", "LA") and img.getextrema()[-1][0] < 255:
            errors.append("appStore1024 含透明像素，App Store 会拒收")
        if name == "appStore1024" and "A" in img.getbands():
            alpha = img.getchannel("A")
            if alpha.getextrema()[0] < 255:
                errors.append("appStore1024 含透明通道")
    if not SPLASH_PATH.is_file():
        errors.append(f"缺少 {SPLASH_PATH.relative_to(ROOT)}")
    else:
        splash = Image.open(SPLASH_PATH)
        if splash.size != SPLASH_SIZE:
            errors.append(f"启动页尺寸 {splash.size}，应为 {SPLASH_SIZE}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        raise SystemExit(1)
    print(f"iOS 图标 {len(ICON_SIZES)} 张与启动页 {SPLASH_SIZE[0]}×{SPLASH_SIZE[1]} 校验通过")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        check()
    else:
        render()


if __name__ == "__main__":
    main()
