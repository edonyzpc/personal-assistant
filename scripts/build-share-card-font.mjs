import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { parseShareCardFontCodePoints } from "./share-card-font-coverage.mjs";
import { shareCardFontManifest } from "./share-card-font-manifest.mjs";

const require = createRequire(import.meta.url);
const subsetFont = require("subset-font");
const fontverter = require("fontverter");
const fontkit = require("fontkit");

const CHECKSUM_MAGIC = 0xB1B0AFBA;
const RENAMED_NAMES = new Map([
    [1, shareCardFontManifest.subset.familyName],
    [3, `2.003R;PA;${shareCardFontManifest.subset.postscriptName}`],
    [4, `${shareCardFontManifest.subset.familyName} Regular`],
    [6, shareCardFontManifest.subset.postscriptName],
    [16, shareCardFontManifest.subset.familyName],
    [21, shareCardFontManifest.subset.familyName],
]);

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const source = await readFile(options.input);
    assertDigest(source, shareCardFontManifest.upstream.sourceSha256, "upstream source font");
    if (source.byteLength !== shareCardFontManifest.upstream.sourceBytes) {
        throw new Error(`Unexpected upstream source size: ${source.byteLength}.`);
    }

    const coverageBytes = await readFile(resolve(shareCardFontManifest.subset.coveragePath));
    assertDigest(coverageBytes, shareCardFontManifest.subset.coverageSha256, "coverage manifest");
    const codePoints = parseShareCardFontCodePoints(coverageBytes.toString("utf8"));
    if (codePoints.length !== shareCardFontManifest.subset.characterCount) {
        throw new Error(`Expected ${shareCardFontManifest.subset.characterCount} code points, got ${codePoints.length}.`);
    }
    const text = String.fromCodePoint(...codePoints);
    const first = await buildSubset(source, text);
    const second = await buildSubset(source, text);
    if (!first.equals(second)) {
        throw new Error("Share Card font generation is not byte-deterministic.");
    }
    validateOutput(first, codePoints);

    const outputPath = resolve(options.output);
    if (options.check) {
        const existing = await readFile(outputPath);
        if (!existing.equals(first)) {
            throw new Error(`Generated Share Card font differs from ${options.output}.`);
        }
        assertExpectedOutput(existing);
        process.stdout.write(`Share Card font is reproducible: ${digest(existing)} (${existing.byteLength} bytes)\n`);
        return;
    }
    await writeFile(outputPath, first);
    process.stdout.write(`Wrote ${options.output}: ${digest(first)} (${first.byteLength} bytes)\n`);
}

async function buildSubset(source, text) {
    const subsetWoff2 = await subsetFont(source, text, {
        targetFormat: "woff2",
        noLayoutClosure: true,
        preserveNameIds: [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17, 21, 22],
    });
    const sfnt = Buffer.from(await fontverter.convert(subsetWoff2, "sfnt", "woff2"));
    const renamed = renameSfntFont(sfnt);
    return Buffer.from(await fontverter.convert(renamed, "woff2", "sfnt"));
}

function renameSfntFont(sfnt) {
    const tables = readSfntTables(sfnt);
    const nameTable = tables.find((table) => table.tag === "name");
    if (!nameTable) throw new Error("Generated font has no name table.");
    nameTable.data = renameNameTable(nameTable.data);

    const headTable = tables.find((table) => table.tag === "head");
    if (!headTable || headTable.data.byteLength < 12) {
        throw new Error("Generated font has no valid head table.");
    }
    headTable.data.writeUInt32BE(0, 8);

    const numTables = tables.length;
    const maxPower = 2 ** Math.floor(Math.log2(numTables));
    const searchRange = maxPower * 16;
    const entrySelector = Math.log2(maxPower);
    const rangeShift = numTables * 16 - searchRange;
    let offset = 12 + numTables * 16;
    for (const table of tables) {
        offset = align4(offset);
        table.offset = offset;
        table.length = table.data.byteLength;
        table.checksum = tableChecksum(table.data);
        offset += align4(table.length);
    }

    const output = Buffer.alloc(offset);
    sfnt.copy(output, 0, 0, 4);
    output.writeUInt16BE(numTables, 4);
    output.writeUInt16BE(searchRange, 6);
    output.writeUInt16BE(entrySelector, 8);
    output.writeUInt16BE(rangeShift, 10);
    tables.forEach((table, index) => {
        const recordOffset = 12 + index * 16;
        output.write(table.tag, recordOffset, 4, "latin1");
        output.writeUInt32BE(table.checksum >>> 0, recordOffset + 4);
        output.writeUInt32BE(table.offset, recordOffset + 8);
        output.writeUInt32BE(table.length, recordOffset + 12);
        table.data.copy(output, table.offset);
    });
    const adjustment = (CHECKSUM_MAGIC - tableChecksum(output)) >>> 0;
    output.writeUInt32BE(adjustment, headTable.offset + 8);
    return output;
}

function readSfntTables(sfnt) {
    if (sfnt.byteLength < 12) throw new Error("Invalid SFNT font.");
    const numTables = sfnt.readUInt16BE(4);
    const tables = [];
    for (let index = 0; index < numTables; index += 1) {
        const recordOffset = 12 + index * 16;
        const tag = sfnt.toString("latin1", recordOffset, recordOffset + 4);
        const offset = sfnt.readUInt32BE(recordOffset + 8);
        const length = sfnt.readUInt32BE(recordOffset + 12);
        if (offset + length > sfnt.byteLength) throw new Error(`Invalid ${tag} table bounds.`);
        tables.push({ tag, data: Buffer.from(sfnt.subarray(offset, offset + length)) });
    }
    return tables;
}

function renameNameTable(table) {
    if (table.byteLength < 6) throw new Error("Invalid name table.");
    const format = table.readUInt16BE(0);
    if (format !== 0) throw new Error(`Unsupported name table format ${format}.`);
    const count = table.readUInt16BE(2);
    const stringOffset = table.readUInt16BE(4);
    const records = [];
    const strings = [];
    let nextStringOffset = 0;
    for (let index = 0; index < count; index += 1) {
        const recordOffset = 6 + index * 12;
        const platformId = table.readUInt16BE(recordOffset);
        const encodingId = table.readUInt16BE(recordOffset + 2);
        const languageId = table.readUInt16BE(recordOffset + 4);
        const nameId = table.readUInt16BE(recordOffset + 6);
        const length = table.readUInt16BE(recordOffset + 8);
        const offset = table.readUInt16BE(recordOffset + 10);
        const original = table.subarray(stringOffset + offset, stringOffset + offset + length);
        const replacement = RENAMED_NAMES.get(nameId);
        const bytes = replacement
            ? encodeName(replacement, platformId)
            : Buffer.from(original);
        records.push({ platformId, encodingId, languageId, nameId, length: bytes.length, offset: nextStringOffset });
        strings.push(bytes);
        nextStringOffset += bytes.length;
    }
    const outputStringOffset = 6 + count * 12;
    const output = Buffer.alloc(outputStringOffset + nextStringOffset);
    output.writeUInt16BE(0, 0);
    output.writeUInt16BE(count, 2);
    output.writeUInt16BE(outputStringOffset, 4);
    records.forEach((record, index) => {
        const recordOffset = 6 + index * 12;
        output.writeUInt16BE(record.platformId, recordOffset);
        output.writeUInt16BE(record.encodingId, recordOffset + 2);
        output.writeUInt16BE(record.languageId, recordOffset + 4);
        output.writeUInt16BE(record.nameId, recordOffset + 6);
        output.writeUInt16BE(record.length, recordOffset + 8);
        output.writeUInt16BE(record.offset, recordOffset + 10);
    });
    let writeOffset = outputStringOffset;
    for (const bytes of strings) {
        bytes.copy(output, writeOffset);
        writeOffset += bytes.length;
    }
    return output;
}

function encodeName(value, platformId) {
    if (platformId !== 0 && platformId !== 3) return Buffer.from(value, "ascii");
    const output = Buffer.alloc(value.length * 2);
    for (let index = 0; index < value.length; index += 1) {
        output.writeUInt16BE(value.charCodeAt(index), index * 2);
    }
    return output;
}

function validateOutput(output, expectedCodePoints) {
    const font = fontkit.create(output);
    if (font.familyName !== shareCardFontManifest.subset.familyName) {
        throw new Error(`Unexpected family name: ${font.familyName}.`);
    }
    if (font.postscriptName !== shareCardFontManifest.subset.postscriptName) {
        throw new Error(`Unexpected PostScript name: ${font.postscriptName}.`);
    }
    const actual = new Set(font.characterSet);
    const allowedExtraCodePoints = shareCardFontManifest.subset.allowedExtraCodePoints ?? [];
    const exactExpected = new Set([...expectedCodePoints, ...allowedExtraCodePoints]);
    const missing = [...exactExpected].filter((codePoint) => !actual.has(codePoint));
    if (missing.length > 0) {
        throw new Error(`Generated font is missing ${missing.length} manifest code points: ${missing
            .map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`)
            .join(", ")}.`);
    }
    const unexpected = [...actual].filter((codePoint) => !exactExpected.has(codePoint));
    if (unexpected.length > 0 || actual.size !== shareCardFontManifest.subset.outputCharacterCount) {
        throw new Error(`Generated font has unexpected character coverage: ${unexpected
            .slice(0, 8)
            .map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`)
            .join(", ") || `${actual.size} characters`}.`);
    }
    const fsType = font["OS/2"]?.fsType;
    if (!fsType || fsType.noEmbedding || fsType.noSubsetting || fsType.bitmapOnly) {
        throw new Error("Generated font metadata does not permit embedding and subsetting.");
    }
}

function assertExpectedOutput(output) {
    const expected = shareCardFontManifest.subset;
    if (expected.outputSha256 === "pending-generation") {
        throw new Error("Share Card font manifest still has a pending output digest.");
    }
    if (output.byteLength !== expected.outputBytes) {
        throw new Error(`Expected ${expected.outputBytes} output bytes, got ${output.byteLength}.`);
    }
    assertDigest(output, expected.outputSha256, "generated Share Card font");
}

function parseArgs(args) {
    const options = {
        input: "",
        output: shareCardFontManifest.subset.outputPath,
        check: false,
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--input") options.input = args[++index] ?? "";
        else if (arg === "--output") options.output = args[++index] ?? "";
        else if (arg === "--check") options.check = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.input) throw new Error("--input requires the official SourceHanSerifSC-Regular.otf path.");
    if (!options.output) throw new Error("--output requires a path.");
    return options;
}

function digest(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function assertDigest(bytes, expected, label) {
    const actual = digest(bytes);
    if (actual !== expected) throw new Error(`Unexpected ${label} SHA-256: ${actual}.`);
}

function align4(value) {
    return (value + 3) & ~3;
}

function tableChecksum(bytes) {
    let sum = 0;
    for (let offset = 0; offset < align4(bytes.byteLength); offset += 4) {
        const a = bytes[offset] ?? 0;
        const b = bytes[offset + 1] ?? 0;
        const c = bytes[offset + 2] ?? 0;
        const d = bytes[offset + 3] ?? 0;
        sum = (sum + (((a << 24) | (b << 16) | (c << 8) | d) >>> 0)) >>> 0;
    }
    return sum >>> 0;
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
