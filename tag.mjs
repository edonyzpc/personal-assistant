import { readFileSync } from "fs";

let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

console.log(manifest.version);