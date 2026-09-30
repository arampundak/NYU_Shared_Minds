"""
prepare.py — builds prep/paintings.json for "Every Time You Look".

What this does, in plain terms:
1. Downloads 24 candidate photos: the NASA astronaut portrait (from
   scikit-image's built-in sample data) and all 24 Kodak test images
   (from the public r0k.us mirror).
2. Draws a numbered contact sheet of all 24 Kodak images (contact-sheet.jpg)
   so a human can look at them and choose 8 for the final album.
3. For the astronaut + the 8 chosen Kodak images (see SELECTED_KODAK below),
   resizes each to 400px on its long side and re-saves it as a JPEG with
   RESTART MARKERS. Restart markers matter here: they let a JPEG decoder
   recover after a corrupted byte instead of the whole rest of the image
   turning to garbage. That's what keeps our "damage" local and pretty.
4. Base64-encodes each finished JPEG and writes them all into
   prep/paintings.json, ready for seed.html to upload to Firestore.

Run it twice if you like:
  - First pass: SELECTED_KODAK can be anything, just look at contact-sheet.jpg.
  - Second pass: update SELECTED_KODAK with your final picks and re-run.
"""

import io
import json
import os

import requests
from PIL import Image, ImageDraw, ImageFont

# ---- settings -------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))

MAX_DIMENSION = 400          # long side, in pixels, of the final saved image
JPEG_QUALITY = 80
RESTART_MARKER_BLOCKS = 4    # smaller = more, shorter-range recovery points

KODAK_URL = "https://r0k.us/graphics/kodak/kodak/kodim{:02d}.png"

# The 8 Kodak images picked for the family album, after looking at the
# contact sheet. Change these numbers and re-run if you want different ones.
SELECTED_KODAK = {
    23: {"title": "The Macaws",         "source": "Kodak test image kodim23"},
    19: {"title": "The Lighthouse",     "source": "Kodak test image kodim19"},
    5:  {"title": "The Motocross Bikes", "source": "Kodak test image kodim05"},
    4:  {"title": "The Girl in the Red Hat", "source": "Kodak test image kodim04"},
    15: {"title": "The Painted Face",   "source": "Kodak test image kodim15"},
    9:  {"title": "The Sailboats",      "source": "Kodak test image kodim09"},
    3:  {"title": "The Straw Hats",     "source": "Kodak test image kodim03"},
    12: {"title": "The Beach Walk",     "source": "Kodak test image kodim12"},
}


# ---- helpers ---------------------------------------------------------------

def fetch_astronaut():
    """Get the NASA portrait of astronaut Eileen Collins from scikit-image."""
    from skimage import data
    array = data.astronaut()  # a numpy array, RGB
    return Image.fromarray(array)


def fetch_kodak(number):
    """Download one Kodak test image (1-24) as a PIL Image."""
    url = KODAK_URL.format(number)
    print(f"  downloading {url}")
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def resize_long_side(img, max_dim):
    """Scale img down so its longer side is max_dim px, keeping proportions."""
    w, h = img.size
    scale = max_dim / max(w, h)
    new_size = (round(w * scale), round(h * scale))
    return img.resize(new_size, Image.LANCZOS)


def to_base64_jpeg(img):
    """Resize, save as a JPEG with restart markers, return base64 text."""
    small = resize_long_side(img, MAX_DIMENSION)
    buf = io.BytesIO()
    small.save(
        buf,
        "JPEG",
        quality=JPEG_QUALITY,
        restart_marker_blocks=RESTART_MARKER_BLOCKS,
    )
    jpeg_bytes = buf.getvalue()
    import base64
    return jpeg_bytes, base64.b64encode(jpeg_bytes).decode("ascii")


def build_contact_sheet(kodak_images):
    """Draw a 4x6 grid of all 24 Kodak images with their numbers on top."""
    thumb_w = 200
    cols, rows = 4, 6
    thumbs = []
    for number in range(1, 25):
        img = kodak_images[number]
        thumb = resize_long_side(img, thumb_w)
        thumbs.append((number, thumb))

    # pad every thumbnail to the same box so the grid lines up
    thumb_h = max(t.size[1] for _, t in thumbs)
    label_h = 24
    cell_w, cell_h = thumb_w, thumb_h + label_h

    sheet = Image.new("RGB", (cell_w * cols, cell_h * rows), "white")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 16)
    except OSError:
        font = ImageFont.load_default()

    for i, (number, thumb) in enumerate(thumbs):
        col = i % cols
        row = i // cols
        x = col * cell_w
        y = row * cell_h
        draw.rectangle([x, y, x + cell_w, y + label_h], fill="black")
        draw.text((x + 6, y + 4), f"kodim{number:02d}", fill="white", font=font)
        sheet.paste(thumb, (x, y + label_h))

    sheet.save(os.path.join(HERE, "contact-sheet.jpg"), "JPEG", quality=85)


# ---- main -------------------------------------------------------------------

def main():
    print("Fetching astronaut portrait from scikit-image...")
    astronaut = fetch_astronaut()

    print("Downloading all 24 Kodak test images (for the contact sheet)...")
    kodak_images = {n: fetch_kodak(n) for n in range(1, 25)}

    print("Building contact-sheet.jpg...")
    build_contact_sheet(kodak_images)

    print("\nPreparing the chosen 9 images...")
    paintings = []

    jpeg_bytes, b64 = to_base64_jpeg(astronaut)
    print(f"  astronaut: {len(jpeg_bytes)} bytes -> {len(b64)} base64 chars")
    paintings.append({
        "id": "astronaut",
        "title": "The Astronaut",
        "source": "NASA portrait of astronaut Eileen Collins (public domain, via scikit-image)",
        "base64": b64,
    })

    for number, info in SELECTED_KODAK.items():
        img = kodak_images[number]
        jpeg_bytes, b64 = to_base64_jpeg(img)
        print(f"  kodim{number:02d}: {len(jpeg_bytes)} bytes -> {len(b64)} base64 chars")
        paintings.append({
            "id": f"kodim{number:02d}",
            "title": info["title"],
            "source": info["source"],
            "base64": b64,
        })

    out_path = os.path.join(HERE, "paintings.json")
    with open(out_path, "w") as f:
        json.dump(paintings, f)

    print(f"\nWrote {out_path} with {len(paintings)} images.")
    print("Look at contact-sheet.jpg — if you want different picks, edit")
    print("SELECTED_KODAK at the top of this script and run it again.")


if __name__ == "__main__":
    main()
