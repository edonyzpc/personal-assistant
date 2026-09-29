from __future__ import annotations

import argparse
import struct
import zlib


def png(width: int, height: int, rgb_a: tuple[int, int, int], rgb_b: tuple[int, int, int]) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    scanlines = bytearray()
    for y in range(height):
        scanlines.append(0)
        for x in range(width):
            color = rgb_a if (x // 16 + y // 8) % 2 == 0 else rgb_b
            scanlines.extend(color)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(scanlines), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic synthetic B-153 PNG fixtures")
    parser.add_argument("output")
    parser.add_argument("--width", type=int, default=160)
    parser.add_argument("--height", type=int, default=80)
    parser.add_argument("--variant", choices=("local", "network"), default="local")
    args = parser.parse_args()
    colors = ((32, 96, 176), (228, 240, 255)) if args.variant == "local" else ((154, 64, 46), (255, 234, 224))
    with open(args.output, "wb") as file:
        file.write(png(args.width, args.height, colors[0], colors[1]))


if __name__ == "__main__":
    main()
