const { readFileSync } = require("node:fs");

module.exports = {
  process(_sourceText, sourcePath) {
    return {
      code: `module.exports = ${JSON.stringify(readFileSync(sourcePath, "utf8"))};`,
    };
  },
};
