import { gzipSync } from "node:zlib";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_INPUT = "dist/main.js";
// Informational budget — bundle size is not a hard release gate per D9. The 1.5 MB ceiling
// leaves ~30% headroom above the post-v2.0.0 baseline (~1.14 MB gzip) for Ops Agent growth.
const DEFAULT_GZIP_BUDGET_BYTES = 1.5 * 1024 * 1024;
// Match the full set of Node builtins so transitive imports (`@langchain/community`, etc.)
// don't sneak into the mobile bundle when only fs/path/child_process are whitelisted.
const NODE_BUILTIN_NAMES = "fs|path|child_process|os|crypto|stream|url|net|tls|http|https|zlib|querystring|readline|buffer|events|util|tty|dns|fs\\/promises|stream\\/promises|module|process|worker_threads";
const NODE_BUILTIN_PATTERN = new RegExp(
    `(?:from\\s+["'](?:node:)?(?:${NODE_BUILTIN_NAMES})["']|require\\(\\s*["'](?:node:)?(?:${NODE_BUILTIN_NAMES})["']\\s*\\))`,
    "g",
);

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const report = await auditBundle(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
        process.exitCode = 1;
    }
}

export async function auditBundle(options = {}) {
    const input = options.input ?? DEFAULT_INPUT;
    const gzipBudgetBytes = options.gzipBudgetBytes ?? DEFAULT_GZIP_BUDGET_BYTES;
    const failOnNodeBuiltins = options.failOnNodeBuiltins ?? true;
    let text;
    try {
        text = await readFile(input, "utf8");
    } catch (error) {
        return {
            ok: false,
            input,
            exists: false,
            gzipBudgetBytes,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    const nodeBuiltinMatches = [...text.matchAll(NODE_BUILTIN_PATTERN)].map((match) => match[0]);
    const bytes = Buffer.byteLength(text);
    const gzipBytes = gzipSync(text).byteLength;
    const overBudget = gzipBytes > gzipBudgetBytes;
    const hasNodeBuiltins = nodeBuiltinMatches.length > 0;
    const resourceAudit = options.resourceDir
        ? await auditResourceDir(options.resourceDir, options.resourceGzipBudgetBytes)
        : undefined;

    return {
        ok: !overBudget
            && !(failOnNodeBuiltins && hasNodeBuiltins)
            && (resourceAudit ? !resourceAudit.overBudget : true),
        input,
        exists: true,
        bytes,
        gzipBytes,
        gzipBudgetBytes,
        overBudget,
        nodeBuiltinReferences: nodeBuiltinMatches,
        ...(resourceAudit ? { resourceAudit } : {}),
    };
}

function parseArgs(args) {
    const options = {
        input: DEFAULT_INPUT,
        gzipBudgetBytes: DEFAULT_GZIP_BUDGET_BYTES,
        failOnNodeBuiltins: true,
        resourceDir: undefined,
        resourceGzipBudgetBytes: undefined,
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--input") {
            options.input = requireValue(args[++index], arg);
        } else if (arg === "--budget-gzip-bytes") {
            options.gzipBudgetBytes = Number(requireValue(args[++index], arg));
        } else if (arg === "--allow-node-builtins") {
            options.failOnNodeBuiltins = false;
        } else if (arg === "--resource-dir") {
            options.resourceDir = requireValue(args[++index], arg);
        } else if (arg === "--resource-gzip-budget-bytes") {
            options.resourceGzipBudgetBytes = Number(requireValue(args[++index], arg));
        } else if (arg === "--help") {
            process.stdout.write([
                "Usage: node scripts/audit-bundle.mjs [--input dist/main.js] [--budget-gzip-bytes 81920] [--allow-node-builtins] [--resource-dir skills --resource-gzip-budget-bytes 61440]",
                "",
            ].join("\n"));
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (!Number.isFinite(options.gzipBudgetBytes) || options.gzipBudgetBytes <= 0) {
        throw new Error("--budget-gzip-bytes must be a positive number");
    }
    if (
        typeof options.resourceGzipBudgetBytes !== "undefined"
        && (!Number.isFinite(options.resourceGzipBudgetBytes) || options.resourceGzipBudgetBytes <= 0)
    ) {
        throw new Error("--resource-gzip-budget-bytes must be a positive number");
    }
    return options;
}

function requireValue(value, flag) {
    if (!value) {
        throw new Error(`${flag} requires a value`);
    }
    return value;
}

async function auditResourceDir(resourceDir, gzipBudgetBytes = 60 * 1024) {
    const files = await listTextFiles(resourceDir);
    const contents = await Promise.all(files.map(async (file) => {
        const text = await readFile(file, "utf8");
        return `--- ${file} ---\n${text}`;
    }));
    const text = contents.join("\n");
    const bytes = Buffer.byteLength(text);
    const gzipBytes = gzipSync(text).byteLength;
    return {
        input: resourceDir,
        fileCount: files.length,
        bytes,
        gzipBytes,
        gzipBudgetBytes,
        overBudget: gzipBytes > gzipBudgetBytes,
    };
}

async function listTextFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listTextFiles(fullPath));
            continue;
        }
        if (!entry.isFile()) continue;
        const info = await stat(fullPath);
        if (info.size === 0) continue;
        if (/\.(md|txt|json|yaml|yml)$/i.test(entry.name)) {
            files.push(fullPath);
        }
    }
    return files.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
