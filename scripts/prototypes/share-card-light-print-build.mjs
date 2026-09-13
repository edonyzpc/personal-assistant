import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

function parseOutDir(argv) {
    const index = argv.indexOf("--out-dir");
    if (index === -1 || !argv[index + 1]) {
        console.error("Usage: node scripts/prototypes/share-card-light-print-build.mjs --out-dir <absolute-dir>");
        process.exitCode = 1;
        return null;
    }
    return resolve(argv[index + 1]);
}

const outDir = parseOutDir(process.argv.slice(2));
if (!outDir) throw new Error("An explicit --out-dir is required.");

const lazyBinaryPlugin = {
    name: "pa-light-print-lazy-binary",
    setup(currentBuild) {
        currentBuild.onLoad({ filter: /\.woff2$/ }, async (args) => {
            const bytes = await readFile(args.path);
            const base64 = bytes.toString("base64");
            return {
                contents: `
var _b64 = ${JSON.stringify(base64)};
var _fontDataUrl = null;
export function getShareCardFontDataUrlAsync() {
    if (_fontDataUrl !== null) return Promise.resolve(_fontDataUrl);
    return Promise.resolve().then(() => {
        _fontDataUrl = "data:font/woff2;base64," + _b64;
        _b64 = null;
        return _fontDataUrl;
    });
}
`,
                loader: "js",
                watchFiles: [args.path],
            };
        });
    },
};

await mkdir(outDir, { recursive: true });
await build({
    absWorkingDir: repoRoot,
    bundle: true,
    entryPoints: [resolve(scriptDir, "share-card-light-print-obsidian.ts")],
    external: ["obsidian"],
    format: "cjs",
    logLevel: "silent",
    outfile: resolve(outDir, "share-card-light-print-probe.cjs"),
    platform: "browser",
    plugins: [lazyBinaryPlugin],
    sourcemap: false,
    target: "es2020",
});

await writeFile(resolve(outDir, "README.txt"), `Temporary Share Card light-print probe API.
Load the CJS file from an Obsidian test-vault eval console and call createProbe(app).
All writes are restricted to vault "test" and a unique child of pa-light-print-probe-20260913.
Call cleanup() after GPT-6 records evidence and completes visible Save interactions.
`);

console.log(JSON.stringify({
    outDir,
    bundle: resolve(outDir, "share-card-light-print-probe.cjs"),
    status: "built",
}, null, 2));
