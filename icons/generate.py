"""Render extension icons from the SVG sources in icons/src/.

The icon is a railroad track in one-point perspective with no backdrop:
sleepers are the review queue, the nearest (widest, amber) sleeper is
"up next". 128/64/48/32 px use the 3-sleeper master, 24/16 px use the
simplified 2-sleeper version.

Rendering is done with headless Chrome on a transparent background.
Usage: python3 icons/generate.py
"""

import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

SIZES = {
    128: 'rail-3.svg',
    64: 'rail-3.svg',
    48: 'rail-3.svg',
    32: 'rail-3.svg',
    24: 'rail-2.svg',
    16: 'rail-2.svg',
}

CHROME_CANDIDATES = [
    os.environ.get('CHROME_BIN'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    shutil.which('google-chrome'),
    shutil.which('chromium'),
]


def find_chrome():
    for candidate in CHROME_CANDIDATES:
        if candidate and os.path.exists(candidate):
            return candidate
    sys.exit('Chrome not found — set CHROME_BIN')


def main():
    chrome = find_chrome()
    for size, source in SIZES.items():
        out = os.path.join(HERE, f'icon{size}.png')
        svg_text = open(os.path.join(HERE, 'src', source)).read()
        svg_text = svg_text.replace(
            'width="100%" height="100%"', f'width="{size}" height="{size}"'
        )
        html = (
            '<!doctype html><html><head><meta charset="utf-8"><style>'
            'html,body{margin:0;padding:0;background:transparent}'
            'svg{display:block}'
            f'</style></head><body>{svg_text}</body></html>'
        )
        tmp = os.path.join(HERE, 'src', f'.render-{size}.html')
        open(tmp, 'w').write(html)
        try:
            subprocess.run(
                [
                    chrome,
                    '--headless=new',
                    '--disable-gpu',
                    '--hide-scrollbars',
                    '--force-device-scale-factor=1',
                    '--default-background-color=00000000',
                    f'--window-size={size},{size}',
                    f'--screenshot={out}',
                    f'file://{tmp}',
                ],
                check=True,
                capture_output=True,
            )
        finally:
            os.remove(tmp)
        print(f'icon{size}.png <- {source}')


if __name__ == '__main__':
    main()
