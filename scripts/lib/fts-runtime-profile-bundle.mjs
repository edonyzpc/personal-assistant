import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const SCRIPT_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FTS_RUNTIME_PROFILE_CANARY_PATH = resolve(
  SCRIPT_DIRECTORY,
  "fts-runtime-profile-canary.ts",
);

export async function buildFtsRuntimeProfileCanarySource() {
  const result = await build({
    entryPoints: [FTS_RUNTIME_PROFILE_CANARY_PATH],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const source = result.outputFiles?.[0]?.text;
  if (!source) throw new Error("Profile canary bundle produced no output.");
  return source;
}
