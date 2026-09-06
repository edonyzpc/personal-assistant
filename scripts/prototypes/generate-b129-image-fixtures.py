#!/usr/bin/env python3
"""Generate synthetic B-129 image probes; requires the installed Pillow only."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import PIL
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin
from PIL.TiffImagePlugin import IFDRational


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "test" / "b129-p0-fixtures"
GENERATOR = "scripts/prototypes/generate-b129-image-fixtures.py"
ENTRIES = []
LIMITATIONS = [
    "All images and metadata are synthetic; no user photos or personal metadata.",
    "Graphics and text test orientation, transparency and readability, not photographic fidelity.",
    "Resource JPEGs vary decoded pixels, not independently controlled encoded byte size.",
    "Two-frame animations do not prove support for long or complex animations.",
    "HEIC is a local sips encoding, not evidence that an iOS photo picker returns an original file.",
]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_output():
    if OUT.exists() and any(OUT.iterdir()):
        manifest_path = OUT / "manifest.json"
        if not manifest_path.is_file():
            raise RuntimeError("Refusing to overwrite an existing unowned fixture directory")
        old = json.loads(manifest_path.read_text())
        if old.get("generator") != GENERATOR:
            raise RuntimeError("Existing fixture manifest belongs to another generator")
        known = {item["filename"]: item["sha256"] for item in old["fixtures"]}
        for path in OUT.iterdir():
            if path.name == "manifest.json":
                continue
            if not path.is_file() or path.name not in known or sha256(path) != known[path.name]:
                raise RuntimeError(f"Refusing to overwrite an unknown or modified file: {path.name}")
    OUT.mkdir(parents=True, exist_ok=True)


def font(size):
    # Pillow's bundled font makes the generator independent of installed system fonts.
    return ImageFont.load_default(size=size)


def chart(frame=0):
    image = Image.new("RGBA", (640, 480), (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    corners = [
        (0, 0, "TL RED", "#ef6b63"),
        (320, 0, "TR GREEN", "#60c786"),
        (0, 240, "BL BLUE", "#69aaf1"),
        (320, 240, "BR YELLOW", "#f3d867"),
    ]
    for x, y, label, color in corners:
        draw.rectangle((x, y, x + 319, y + 239), fill=color)
        draw.text((x + 16, y + 16), label, font=font(28), fill="black")
    draw.rectangle((35, 88, 604, 194), fill="white", outline="black", width=2)
    draw.text((48, 96), f"SYNTHETIC B-129 / FRAME {frame + 1}", font=font(24), fill="black")
    draw.text((48, 134), "16 px: Review second image; retain all originals.", font=font(16), fill="black")
    draw.text((48, 166), "12 px: ABCDEFGH 0123456789 small-text readability", font=font(12), fill="black")
    draw.rectangle((70, 326, 274, 429), fill=(0, 0, 0, 0))
    draw.text((72, 302), "ALPHA 0", font=font(18), fill="black")
    draw.rectangle((365, 326, 569, 429), fill=(255, 0, 255, 128))
    draw.text((367, 302), "ALPHA 128", font=font(18), fill="black")
    # Frame motion plus different text makes an accidental static first frame visible.
    x = 80 if frame == 0 else 490
    draw.ellipse((x, 202, x + 34, 236), fill="black", outline="white", width=3)
    return image


def flatten(image):
    background = Image.new("RGBA", image.size, "white")
    return Image.alpha_composite(background, image).convert("RGB")


def record(filename, purpose, metadata=None, **extra):
    path = OUT / filename
    entry = {
        "filename": filename,
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "purpose": purpose,
        "metadata": metadata or {},
        **extra,
    }
    if path.suffix not in (".svg", ".heic"):
        with Image.open(path) as image:
            orientation = image.getexif().get(274, 1)
            entry.update({
                "format": image.format,
                "storedWidth": image.width,
                "storedHeight": image.height,
                "expectedOrientedWidth": image.height if orientation in (5, 6, 7, 8) else image.width,
                "expectedOrientedHeight": image.width if orientation in (5, 6, 7, 8) else image.height,
                "orientation": orientation,
                "frames": getattr(image, "n_frames", 1),
                "mode": image.mode,
            })
            if getattr(image, "n_frames", 1) > 1:
                durations = []
                frame_hashes = []
                for index in range(image.n_frames):
                    image.seek(index)
                    rgba = image.convert("RGBA")
                    frame_hashes.append(hashlib.sha256(rgba.tobytes()).hexdigest())
                    durations.append(image.info.get("duration"))
                entry["decodedFrameSha256"] = frame_hashes
                entry["decodedFrameDurationMs"] = durations
                assert len(set(frame_hashes)) == 2, "Animation must contain two visibly different frames"
    ENTRIES.append(entry)


def static_and_animated():
    first, second = chart(), chart(1)
    png_info = PngImagePlugin.PngInfo()
    png_info.add_text("Description", "B-129 synthetic fixture; no personal data")
    first.save(OUT / "chart-transparent.png", pnginfo=png_info)
    record("chart-transparent.png", "Static pixels, four corners, alpha 0/128, 12/16/24 px text",
           {"Description": "B-129 synthetic fixture; no personal data"})
    first.save(OUT / "chart-static.webp", lossless=True)
    record("chart-static.webp", "Lossless static WebP with transparency")

    exif = Image.Exif()
    exif[274] = 6
    exif[271] = "B129 SYNTHETIC CAMERA"
    exif[272] = "FICTIONAL MODEL 000"
    exif[306] = "2000:01:01 00:00:00"
    exif[34665] = {36867: "2000:01:01 00:00:00", 36868: "2000:01:01 00:00:00"}
    exif[34853] = {
        0: b"\x02\x03\x00\x00", 1: "N", 2: (IFDRational(0), IFDRational(0), IFDRational(0)),
        3: "E", 4: (IFDRational(0), IFDRational(0), IFDRational(0)),
        7: (IFDRational(0), IFDRational(0), IFDRational(0)), 29: "2000:01:01",
    }
    flatten(first).save(OUT / "chart-exif-orientation-6.jpg", quality=93, subsampling=0, exif=exif)
    with Image.open(OUT / "chart-exif-orientation-6.jpg") as saved:
        actual_exif = saved.getexif()
        assert actual_exif[274] == 6 and actual_exif[271] == "B129 SYNTHETIC CAMERA"
        assert actual_exif.get_ifd(34853)[1] == "N"
        assert actual_exif.get_ifd(34665)[36867] == "2000:01:01 00:00:00"
    record("chart-exif-orientation-6.jpg", "EXIF orientation and provider metadata-removal probe", {
        "synthetic": True, "Make": exif[271], "Model": exif[272],
        "DateTime": exif[306], "DateTimeOriginal": "2000:01:01 00:00:00",
        "DateTimeDigitized": "2000:01:01 00:00:00",
        "GPS": {"latitude": 0, "longitude": 0, "date": "2000:01:01", "time": "00:00:00"},
    }, expectedDisplayedCorners={"TL": "BL BLUE", "TR": "TL RED", "BL": "BR YELLOW", "BR": "TR GREEN"})

    flatten(first).save(OUT / "chart-animated.gif", save_all=True, append_images=[flatten(second)],
                        duration=[400, 700], loop=0, disposal=2)
    record("chart-animated.gif", "Two opaque frames, marker moves left to right", expectedFrameDurationMs=[400, 700])
    first.save(OUT / "chart-animated.apng", format="PNG", save_all=True, append_images=[second],
               duration=[400, 700], loop=0, disposal=0, blend=0)
    record("chart-animated.apng", "Two RGBA frames, marker moves left to right", expectedFrameDurationMs=[400, 700])
    first.save(OUT / "chart-animated.webp", save_all=True, append_images=[second], lossless=True,
               duration=[400, 700], loop=0)
    record("chart-animated.webp", "Two lossless RGBA frames", expectedFrameDurationMs=[400, 700])
    first.close()
    second.close()


def svg_fixtures():
    base = '''<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<rect width="320" height="240" fill="#ef6b63"/><rect x="320" width="320" height="240" fill="#60c786"/>
<rect y="240" width="320" height="240" fill="#69aaf1"/><rect x="320" y="240" width="320" height="240" fill="#f3d867"/>
<g font-family="sans-serif" font-size="28"><text x="16" y="45">TL RED</text><text x="336" y="45">TR GREEN</text>
<text x="16" y="285">BL BLUE</text><text x="336" y="285">BR YELLOW</text></g>
<rect x="35" y="85" width="570" height="90" fill="white"/>
<text x="48" y="118" font-family="sans-serif" font-size="24">SYNTHETIC B-129 SVG</text>
<text x="48" y="150" font-family="sans-serif" font-size="12">12 px ABCDEFGH 0123456789 readability</text>
<circle cx="450" cy="370" r="58" fill="#f0f" fill-opacity="0.5"/>
EXTRA
</svg>
'''
    for filename, extra, purpose in [
        ("chart-self-contained.svg", "", "Self-contained SVG; no script or external resource"),
        ("chart-external-resource.svg",
         '<image x="220" y="185" width="200" height="100" href="https://b129-image-fixtures.invalid/external-tile.png"/>',
         "External SVG resource is deliberately unavailable; decoder must not claim complete external content"),
    ]:
        (OUT / filename).write_text(base.replace("EXTRA", extra), encoding="utf-8")
        record(filename, purpose, storedWidth=640, storedHeight=480,
               expectedOrientedWidth=640, expectedOrientedHeight=480, frames=1, format="SVG",
               externalUrls=["https://b129-image-fixtures.invalid/external-tile.png"] if extra else [])


def resource_ladder():
    colors = ["#ef6b63", "#60c786", "#69aaf1", "#f3d867"]
    for mp, width, height in [(12, 4000, 3000), (24, 6000, 4000), (48, 8000, 6000)]:
        image = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(image)
        for x in range(0, width, 128):
            draw.rectangle((x, 0, x + 63, height - 1), fill=colors[(x // 128) % 4])
        for y in range(0, height, 128):
            draw.line((0, y, width - 1, y), fill="black", width=3)
        draw.rectangle((40, 40, 1800, 250), fill="white", outline="black", width=4)
        draw.text((60, 60), f"SYNTHETIC {mp} MP / {width} x {height}", font=font(64), fill="black")
        draw.text((60, 160), "Deterministic stripes; pixel/memory probe, not a photograph.", font=font(36), fill="black")
        filename = f"resource-{mp}mp.jpg"
        image.save(OUT / filename, quality=90, subsampling=0)
        image.close()
        record(filename, "Decoded-resource ladder; encoded size is not padded", megapixels=mp)


def optional_heic():
    sips = shutil.which("sips")
    if not sips:
        return {"status": "unavailable", "reason": "sips not installed"}
    source, destination = OUT / "chart-transparent.png", OUT / "chart-sips.heic"
    command = [sips, "-s", "format", "heic", str(source), "--out", str(destination)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=45, check=False)
    except subprocess.TimeoutExpired:
        if destination.exists():
            destination.unlink()
        return {"status": "failed", "command": command, "source": source.name,
                "reason": "sips encoding exceeded 45 seconds"}
    status = {"command": command, "exitCode": result.returncode,
              "output": (result.stdout + result.stderr).strip(), "source": source.name}
    if result.returncode == 0 and destination.is_file() and destination.stat().st_size:
        properties = subprocess.run([sips, "-g", "all", str(destination)],
                                    capture_output=True, text=True, timeout=15, check=False)
        values = dict(line.strip().split(": ", 1) for line in properties.stdout.splitlines()
                      if ": " in line)
        width = int(values["pixelWidth"]) if values.get("pixelWidth", "").isdigit() else None
        height = int(values["pixelHeight"]) if values.get("pixelHeight", "").isdigit() else None
        record(destination.name, "Synthetic PNG encoded by local macOS sips; not camera/photo-picker provenance",
               {"inspection": "Pillow has no HEIC decoder here; sips properties recorded, not full metadata audit",
                "sipsProperties": properties.stdout.strip()},
               format="HEIC", storedWidth=width, storedHeight=height,
               expectedOrientedWidth=640, expectedOrientedHeight=480, frames=1,
               expectedFromSyntheticSource=True, encoder="macOS sips", sourceFilename=source.name)
        status["status"] = "generated"
    else:
        if destination.exists():
            destination.unlink()
        status["status"] = "failed"
    return status


def main():
    prepare_output()
    static_and_animated()
    svg_fixtures()
    resource_ladder()
    heic = optional_heic()
    manifest = {"generator": GENERATOR, "schemaVersion": 1, "pillowVersion": PIL.__version__,
                "syntheticOnly": True, "fixtures": ENTRIES, "optionalHeic": heic,
                "limitations": LIMITATIONS}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(OUT), "fixtures": len(ENTRIES),
                      "totalBytes": sum(item["bytes"] for item in ENTRIES), "heic": heic["status"]}))


if __name__ == "__main__":
    main()
