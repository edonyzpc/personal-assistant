/**
 * @file This file reads the version from manifest.json and prints it to the console.
 * @copyright Copyright (c) 2023 edonyzpc
 */

import { readFileSync } from "fs";

let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

console.log(manifest.version);