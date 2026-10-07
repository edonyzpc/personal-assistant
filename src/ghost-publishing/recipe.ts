import { stableHash } from "../pa/helpers";
import { GhostExportError } from "./errors";
import type {
    ExportCapabilities,
    GhostPublishingRecipeInjection,
    RecipeAsset,
    RecipeSelection,
    SitePublishingProfile,
} from "./types";

const CDN = "https://cdn.jsdelivr.net/npm";
const RECIPE_VERSION = "b153-v1";

const assets = {
    prismCore: {
        url: `${CDN}/prismjs@1.30.0/components/prism-core.min.js`,
        integrity: "sha384-zLRFO4dwowZvh8kzutOb5AWhH7f39HeJp+N7PtHF1SQtTBnifRx0AtmvTYs3F4YV",
    },
    prismClike: {
        url: `${CDN}/prismjs@1.30.0/components/prism-clike.min.js`,
        integrity: "sha384-7LHwxHIDSHTBleLmgDWZbC/IMJsfYfFVOihKhvsrxYW4j47YQcRwZja4ToFE3bA8",
    },
    prismJavascript: {
        url: `${CDN}/prismjs@1.30.0/components/prism-javascript.min.js`,
        integrity: "sha384-D44bgYYKvaiDh4cOGlj1dbSDpSctn2FSUj118HZGmZEShZcO2v//Q5vvhNy206pp",
    },
    prismTypescript: {
        url: `${CDN}/prismjs@1.30.0/components/prism-typescript.min.js`,
        integrity: "sha384-PeOqKNW/piETaCg8rqKFy+Pm6KEk7e36/5YZE5XO/OaFdO+/Aw3O8qZ9qDPKVUgx",
    },
    prismCss: {
        url: `${CDN}/prismjs@1.30.0/themes/prism.min.css`,
        integrity: "sha384-rCCjoCPCsizaAAYVoz1Q0CmCTvnctK0JkfCSjx7IIxexTBg+uCKtFYycedUjMyA2",
    },
    mermaid: {
        url: `${CDN}/mermaid@12.0.0/dist/mermaid.min.js`,
        integrity: "sha384-xzghz1GQ5u9HCpVskeDPqMsdogD1yvuMQbEK53+wi+G70+6J1AG0L2cfi9PHjDWI",
    },
    katex: {
        url: `${CDN}/katex@0.18.9/dist/katex.min.js`,
        integrity: "sha384-19KE2cFb3U+RUWmyhBz7aLOGDG8WrRC6hE3oY/HTZZlAAVWYTdmvLC//+TIV3zUx",
    },
    katexAutoRender: {
        url: `${CDN}/katex@0.18.9/dist/contrib/auto-render.min.js`,
        integrity: "sha384-bjyGPfbij8/NDKJhSGZNP/khQVgtHUE5exjm4Ydllo42FwIgYsdLO2lXGmRBf5Mz",
    },
    katexCss: {
        url: `${CDN}/katex@0.18.9/dist/katex.min.css`,
        integrity: "sha384-lPx0C4zIUZLpveABMwOFcFeGZwsvKBJfhJ85FN1PYOV7xApBcFMhcAEMVKF8loOI",
    },
} satisfies Record<string, RecipeAsset>;

const PRISM_GRAMMARS: Record<string, RecipeAsset[]> = {
    javascript: [assets.prismClike, assets.prismJavascript],
    js: [assets.prismClike, assets.prismJavascript],
    typescript: [assets.prismClike, assets.prismJavascript, assets.prismTypescript],
    ts: [assets.prismClike, assets.prismJavascript, assets.prismTypescript],
};

function canReuse(profile: SitePublishingProfile | undefined, key: "prism" | "mermaid" | "katex"): boolean {
    const library = profile?.[key];
    return library?.compatible === true && library.evidence !== "unknown";
}

function uniqueAssets(groups: RecipeAsset[][]): RecipeAsset[] {
    const seen = new Set<string>();
    const output: RecipeAsset[] = [];
    for (const group of groups) {
        for (const asset of group) {
            if (seen.has(asset.url)) continue;
            seen.add(asset.url);
            output.push(asset);
        }
    }
    return output;
}

export function selectRecipe(
    capabilities: ExportCapabilities,
    profile: SitePublishingProfile,
): RecipeSelection {
    const normalizedLanguages = [...new Set(capabilities.codeLanguages.map((language) => language.toLowerCase()))].sort();
    const knownLanguages = normalizedLanguages.filter((language) => language in PRISM_GRAMMARS);
    const needsPrism = knownLanguages.length > 0;
    const needsMermaid = capabilities.hasMermaid;
    const needsKatex = capabilities.hasInlineMath || capabilities.hasDisplayMath;
    const loadsPrism = needsPrism && !canReuse(profile, "prism");
    const loadsMermaid = needsMermaid && !canReuse(profile, "mermaid");
    const loadsKatex = needsKatex && !canReuse(profile, "katex");
    const initializesPrism = needsPrism
        && (!canReuse(profile, "prism") || profile.prism?.initialization === "explicit");
    const initializesMermaid = needsMermaid
        && (!canReuse(profile, "mermaid") || profile.mermaid?.initialization === "explicit");
    const initializesKatex = needsKatex
        && (!canReuse(profile, "katex") || profile.katex?.initialization === "explicit");
    const prismAssets = uniqueAssets(knownLanguages.map((language) => PRISM_GRAMMARS[language] ?? []));
    const headAssets = [
        ...(loadsPrism ? [assets.prismCss] : []),
        ...(loadsKatex ? [assets.katexCss] : []),
    ];
    const footAssets = [
        ...(loadsPrism ? [assets.prismCore] : []),
        ...(loadsPrism ? prismAssets : []),
        ...(loadsKatex ? [assets.katex, assets.katexAutoRender] : []),
        ...(loadsMermaid ? [assets.mermaid] : []),
    ];
    const canonical = {
        version: RECIPE_VERSION as "b153-v1",
        needsPrism,
        loadsPrism,
        initializesPrism,
        prismLanguages: knownLanguages,
        needsMermaid,
        loadsMermaid,
        initializesMermaid,
        needsKatex,
        loadsKatex,
        initializesKatex,
        headAssets,
        footAssets,
    };
    return {
        ...canonical,
        prismLanguages: knownLanguages,
        reuse: {
            prism: needsPrism && !loadsPrism,
            mermaid: needsMermaid && !loadsMermaid,
            katex: needsKatex && !loadsKatex,
        },
        headAssets,
        footAssets,
        contentHash: stableHash(JSON.stringify(canonical)),
    };
}

function marker(kind: "head" | "foot", position: "begin" | "end", contentHash: string): string {
    if (position === "end") return `<!-- pa-ghost:end recipe ${kind} ${RECIPE_VERSION} -->`;
    return `<!-- pa-ghost:${position} recipe ${kind} ${RECIPE_VERSION} hash=${contentHash} -->`;
}

function scriptTag(asset: RecipeAsset): string {
    return `<script src="${asset.url}" integrity="${asset.integrity}" crossorigin="anonymous"></script>`;
}

function styleTag(asset: RecipeAsset): string {
    return `<link rel="stylesheet" href="${asset.url}" integrity="${asset.integrity}" crossorigin="anonymous">`;
}

function profileInitialization(
    profile: SitePublishingProfile,
    key: "prism" | "mermaid" | "katex",
): "reused-auto" | "reused-unverified" {
    return profile[key]?.initialization === "auto" ? "reused-auto" : "reused-unverified";
}

function managedRegion(
    kind: "head" | "foot",
    selection: RecipeSelection,
    profile: SitePublishingProfile,
): string {
    const diagnostics = `window.__paGhostRecipe={version:"${RECIPE_VERSION}",contentHash:"${selection.contentHash}"}`;
    if (kind === "head") {
        const inner = [
            ...selection.headAssets.map(styleTag),
            `<script>${diagnostics};${
                selection.loadsPrism
                    ? "window.Prism=window.Prism||{};window.Prism.manual=true;"
                    : `window.__paGhostRecipe.prism="${profileInitialization(profile, "prism")}";`
            }${
                selection.needsMermaid && !selection.initializesMermaid
                    ? `window.__paGhostRecipe.mermaid="${profileInitialization(profile, "mermaid")}";`
                    : ""
            }${
                selection.needsKatex && !selection.initializesKatex
                    ? `window.__paGhostRecipe.math="${profileInitialization(profile, "katex")}";`
                    : ""
            }</script>`,
        ].join("\n");
        const regionHash = stableHash(inner);
        return [
            marker(kind, "begin", regionHash),
            inner,
            marker(kind, "end", regionHash),
        ].join("\n");
    }

    const parts: string[] = [];
    for (const asset of selection.footAssets) parts.push(scriptTag(asset));
    if (selection.initializesPrism) {
        const grammars = JSON.stringify(selection.prismLanguages);
        parts.push(`<script>(function(){var r=window.__paGhostRecipe;try{if(!window.Prism||typeof window.Prism.highlightAllUnder!=="function"||!window.Prism.languages){throw new Error("Prism core unavailable")}var needed=${grammars};for(var i=0;i<needed.length;i++){if(!window.Prism.languages[needed[i]]){throw new Error("Prism grammar unavailable: "+needed[i])}}window.Prism.highlightAllUnder(document.body);r.prism="loaded"}catch(e){r.prism="error";r.prismError=String(e&&e.message||e)}})();</script>`);
    }
    if (selection.initializesKatex) {
        parts.push(`<script>(function(){var r=window.__paGhostRecipe;try{if(typeof window.renderMathInElement!=="function"||!window.katex){throw new Error("KaTeX or auto-render unavailable")}window.renderMathInElement(document.body,{delimiters:[{left:"\\\\(",right:"\\\\)"},{left:"\\\\[",right:"\\\\]",display:true}],throwOnError:false});r.math="loaded"}catch(e){r.math="error";r.mathError=String(e&&e.message||e)}})();</script>`);
    }
    if (selection.initializesMermaid) {
        parts.push(`<script>(async function(){var r=window.__paGhostRecipe;try{var m=window.mermaid;if(!m||typeof m.initialize!=="function"||typeof m.run!=="function"){throw new Error("Mermaid global API unavailable")}m.initialize({startOnLoad:false,securityLevel:"strict",theme:"default"});await m.run({nodes:Array.from(document.querySelectorAll('pre code.language-mermaid')),suppressErrors:false});if(document.querySelectorAll('svg[id^="mermaid"],svg.mermaid').length===0){throw new Error("Mermaid rendered no SVG")}r.mermaid="rendered"}catch(e){r.mermaid="failed";r.mermaidError=String(e&&e.message||e)}})();</script>`);
    }
    const inner = parts.join("\n");
    const regionHash = stableHash(inner);
    return [
        marker(kind, "begin", regionHash),
        inner,
        marker(kind, "end", regionHash),
    ].join("\n");
}

function removeVerifiedManagedRegion(
    value: string,
    kind: "head" | "foot",
): { before: string; after: string; hadRegion: boolean } {
    if (!value) return { before: "", after: "", hadRegion: false };
    const beginCount = (value.match(/<!-- pa-ghost:begin recipe /g) ?? []).length;
    const endCount = (value.match(/<!-- pa-ghost:end recipe /g) ?? []).length;
    if (beginCount + endCount > 0 && beginCount !== endCount) {
        throw new GhostExportError(
            "recipe-region-conflict",
            `PA injection markers are incomplete: ${beginCount} begin and ${endCount} end markers.`,
        );
    }
    const beginPattern = /<!-- pa-ghost:begin recipe (head|foot) ([^ ]+) hash=([0-9a-f]+) -->/g;
    const matches = [...value.matchAll(beginPattern)].filter((match) => match[1] === kind);
    const endPattern = new RegExp(`<!-- pa-ghost:end recipe (head|foot) ${RECIPE_VERSION} -->`, "g");
    const endMatches = [...value.matchAll(endPattern)].filter((match) => match[1] === kind);
    if (beginCount + endCount > 0 && (matches.length !== 1 || endMatches.length !== 1)) {
        throw new GhostExportError(
            "recipe-region-conflict",
            `PA ${kind} injection marker is malformed or has an unexpected kind.`,
        );
    }
    if (matches.length === 0) return { before: value, after: "", hadRegion: false };
    if (matches.length > 1) {
        throw new GhostExportError("recipe-region-conflict", `Multiple PA ${kind} injection regions found.`);
    }
    const match = matches[0];
    const version = match[2];
    const expectedHash = match[3];
    if (version !== RECIPE_VERSION) {
        throw new GhostExportError("recipe-region-conflict", `PA recipe region version ${version} requires migration.`);
    }
    const begin = match.index ?? 0;
    const endMarker = `<!-- pa-ghost:end recipe ${kind} ${version} -->`;
    const end = value.indexOf(endMarker, begin);
    if (end < 0) {
        throw new GhostExportError("recipe-region-conflict", `PA ${kind} injection region has no end marker.`);
    }
    const beginMarker = marker(kind, "begin", expectedHash);
    const innerStart = begin + beginMarker.length + 1;
    const innerEnd = end - 1;
    const inner = value.slice(innerStart, innerEnd);
    if (stableHash(inner) !== expectedHash) {
        throw new GhostExportError("recipe-region-conflict", `PA ${kind} injection region was modified.`);
    }
    return {
        before: value.slice(0, begin),
        after: value.slice(end + endMarker.length),
        hadRegion: true,
    };
}

function mergeInjection(
    manual: string | undefined,
    managed: string,
    kind: "head" | "foot",
): { value: string; manualPreserved: boolean } {
    const split = removeVerifiedManagedRegion(manual ?? "", kind);
    if (!managed) {
        return { value: split.before + split.after, manualPreserved: true };
    }
    const value = split.hadRegion
        ? `${split.before}${managed}${split.after}`
        : (manual ?? "").length > 0
            ? `${manual}\n${managed}`
            : managed;
    const preservedOutside = split.before + split.after;
    return {
        value,
        manualPreserved: (manual ?? "").length === 0
            || (split.hadRegion ? value.includes(preservedOutside) : value.startsWith(manual ?? "")),
    };
}

export function buildRecipeInjection(
    capabilities: ExportCapabilities,
    profile: SitePublishingProfile,
): GhostPublishingRecipeInjection {
    const selection = selectRecipe(capabilities, profile);
    const requiresInjection = selection.headAssets.length > 0 || selection.footAssets.length > 0
        || selection.initializesPrism || selection.initializesMermaid || selection.initializesKatex;
    const head = mergeInjection(profile.manualHeadInjection,
        requiresInjection ? managedRegion("head", selection, profile) : "", "head");
    const foot = mergeInjection(profile.manualFootInjection,
        requiresInjection ? managedRegion("foot", selection, profile) : "", "foot");
    return {
        head: head.value,
        foot: foot.value,
        selection,
        manualHeadPreserved: head.manualPreserved,
        manualFootPreserved: foot.manualPreserved,
    };
}
