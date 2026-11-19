// The World in One Day — 19 November 2026.
// Node 22, standard library only, no network. Reads the entry.png beside
// this file, verifies it is one whole PNG (signature, IHDR, every chunk's
// CRC, IEND present, nothing after IEND), checks the gate limits
// (at most 1 MiB, at most 1024 by 1024 pixels), then writes the exact
// bytes to /output/entry.png.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1_048_576;
const MAX_SIDE = 1024;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// CRC-32 (IEEE) table, built once at startup.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function fail(message: string): never {
  console.error(`entry.png rejected: ${message}`);
  process.exit(1);
}

interface Chunk {
  type: string;
  length: number;
  dataStart: number;
  dataEnd: number;
  crcEnd: number;
}

// Yields every chunk in order, verifying each chunk's CRC as it goes.
// Stops after IEND; anything after IEND is an error, not a chunk.
function* walkChunks(bytes: Buffer): Generator<Chunk> {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > bytes.length) {
      fail(`chunk ${type} is truncated`);
    }
    const stored = bytes.readUInt32BE(dataEnd);
    const actual = crc32(bytes.subarray(offset + 4, dataEnd));
    if (stored !== actual) {
      fail(`chunk ${type} fails its CRC check`);
    }
    yield { type, length, dataStart, dataEnd, crcEnd };
    if (type === "IEND") {
      if (length !== 0) {
        fail("IEND carries data");
      }
      if (crcEnd !== bytes.length) {
        fail("bytes follow the IEND chunk");
      }
      return;
    }
    offset = crcEnd;
  }
}

function validateWholePng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail("missing PNG signature");
  }
  if (bytes.length > MAX_BYTES) {
    fail(`file is ${bytes.length} bytes, over the 1 MiB limit`);
  }
  let width = 0;
  let height = 0;
  let sawIend = false;
  let sawIdat = false;
  let first = true;
  for (const chunk of walkChunks(bytes)) {
    if (first) {
      if (chunk.type !== "IHDR") {
        fail("first chunk is not IHDR");
      }
      if (chunk.length !== 13) {
        fail("IHDR has the wrong length");
      }
      width = bytes.readUInt32BE(chunk.dataStart);
      height = bytes.readUInt32BE(chunk.dataStart + 4);
      first = false;
    }
    if (chunk.type === "IDAT") {
      sawIdat = true;
    }
    if (chunk.type === "IEND") {
      sawIend = true;
    }
  }
  if (!sawIend) {
    fail("no IEND chunk found");
  }
  if (!sawIdat) {
    fail("no IDAT chunk found: the PNG carries no image data");
  }
  if (width > MAX_SIDE || height > MAX_SIDE) {
    fail(`image is ${width}x${height}, over the 1024x1024 limit`);
  }
  return { width, height };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = join(here, "entry.png");
  const bytes = readFileSync(source);
  const { width, height } = validateWholePng(bytes);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), bytes);
  console.log(
    `wrote entry.png: ${width}x${height}, ${bytes.length} bytes, whole PNG verified`,
  );
}

main();
