const base = require('../../jest.config.js');

// Keep the base config as the complete release/coverage gate. New unclassified
// tests stay in the source group; scripts conventionally use *-script.test.ts.
const artifacts = [
  'fts-ios-runtime-receipt',
  'fts-runtime-probe-script',
];
const tooling = [
  'fts-evidence-calibration',
  'pa-docs-lifecycle-skills',
  'retrieval-evidence-receipt-verify',
  'retrieval-opfs-restart-runner',
  'retrieval-performance-fixture',
  'retrieval-smoke-runner',
];
const testPaths = (names) => names.map((name) => `<rootDir>/__tests__/${name}.test.ts`);
const ignoredTests = (names) => names.map((name) => `/__tests__/${name}\\.test\\.ts$`);
const toolingPattern = '<rootDir>/__tests__/*-script.test.ts';

module.exports = {
  source: {
    ...base,
    testPathIgnorePatterns: [
      ...base.testPathIgnorePatterns,
      '/__tests__/[^/]+-script\\.test\\.ts$',
      ...ignoredTests([...tooling, ...artifacts]),
    ],
  },
  tooling: {
    ...base,
    testMatch: [toolingPattern, ...testPaths(tooling)],
    testPathIgnorePatterns: [...base.testPathIgnorePatterns, ...ignoredTests(artifacts)],
  },
  artifacts: { ...base, testMatch: testPaths(artifacts) },
};
