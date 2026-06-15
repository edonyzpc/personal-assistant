/**
 * SPEC-A6 Spike: JS brute-force vector search PoC
 *
 * Validates that a pure-JS cosine-similarity search over 10k x 1024-dim
 * vectors is fast enough to replace @sqliteai's compiled vector_full_scan.
 *
 * Run: npx tsx tmp/brute-force-poc.ts
 */

function bruteForceTopK(
    queryVec: Float32Array,
    vectors: Map<string, Float32Array>,
    k: number,
): Array<{ id: string; distance: number }> {
    // Pre-compute query magnitude
    let queryMag = 0;
    for (let i = 0; i < queryVec.length; i++) {
        queryMag += queryVec[i] * queryVec[i];
    }
    queryMag = Math.sqrt(queryMag);

    if (queryMag === 0) {
        // Zero vector: all distances are 1 (maximally dissimilar)
        const results: Array<{ id: string; distance: number }> = [];
        let count = 0;
        for (const id of vectors.keys()) {
            if (count >= k) break;
            results.push({ id, distance: 1 });
            count++;
        }
        return results;
    }

    // Use a simple array + partial sort for top-k (heap would be overkill for k=10)
    const scores: Array<{ id: string; distance: number }> = [];

    for (const [id, vec] of vectors) {
        let dot = 0;
        let vecMag = 0;
        for (let i = 0; i < vec.length; i++) {
            dot += queryVec[i] * vec[i];
            vecMag += vec[i] * vec[i];
        }
        vecMag = Math.sqrt(vecMag);

        // Cosine distance = 1 - cosine_similarity
        const similarity = vecMag === 0 ? 0 : dot / (queryMag * vecMag);
        const distance = 1 - similarity;

        scores.push({ id, distance });
    }

    // Sort ascending by distance (closest first) and take top-k
    scores.sort((a, b) => a.distance - b.distance);
    return scores.slice(0, k);
}

// --- Performance benchmark ---

function generateRandomVec(dim: number): Float32Array {
    const vec = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
        vec[i] = Math.random() * 2 - 1; // [-1, 1]
    }
    return vec;
}

function runBenchmark(): void {
    const DIM = 1024;
    const NUM_VECTORS = 10_000;
    const NUM_QUERIES = 100;
    const TOP_K = 10;

    console.log(`Generating ${NUM_VECTORS} vectors of dimension ${DIM}...`);
    const genStart = performance.now();
    const vectors = new Map<string, Float32Array>();
    for (let i = 0; i < NUM_VECTORS; i++) {
        vectors.set(`doc-${i}`, generateRandomVec(DIM));
    }
    const genDuration = performance.now() - genStart;
    console.log(`Generation took ${genDuration.toFixed(1)}ms`);

    // Memory estimate
    const bytesPerVector = DIM * 4; // Float32
    const totalMB = (NUM_VECTORS * bytesPerVector) / (1024 * 1024);
    console.log(`Memory for vectors: ~${totalMB.toFixed(1)}MB`);

    // Cold query (first run, no JIT warmup)
    const coldQuery = generateRandomVec(DIM);
    const coldStart = performance.now();
    const coldResult = bruteForceTopK(coldQuery, vectors, TOP_K);
    const coldDuration = performance.now() - coldStart;
    console.log(`\nCold query: ${coldDuration.toFixed(2)}ms`);
    console.log(`  Top result: id=${coldResult[0].id}, distance=${coldResult[0].distance.toFixed(4)}`);

    // Warm queries
    const queryVecs = Array.from({ length: NUM_QUERIES }, () => generateRandomVec(DIM));
    const durations: number[] = [];

    console.log(`\nRunning ${NUM_QUERIES} warm queries (top-${TOP_K})...`);
    for (let i = 0; i < NUM_QUERIES; i++) {
        const start = performance.now();
        bruteForceTopK(queryVecs[i], vectors, TOP_K);
        durations.push(performance.now() - start);
    }

    durations.sort((a, b) => a - b);
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    const p50 = durations[Math.floor(durations.length * 0.5)];
    const p95 = durations[Math.floor(durations.length * 0.95)];
    const p99 = durations[Math.floor(durations.length * 0.99)];
    const min = durations[0];
    const max = durations[durations.length - 1];

    console.log(`\n--- Results (${NUM_VECTORS} vectors, ${DIM}-dim, top-${TOP_K}) ---`);
    console.log(`  Cold query:  ${coldDuration.toFixed(2)}ms`);
    console.log(`  Avg:         ${avg.toFixed(2)}ms`);
    console.log(`  Min:         ${min.toFixed(2)}ms`);
    console.log(`  P50:         ${p50.toFixed(2)}ms`);
    console.log(`  P95:         ${p95.toFixed(2)}ms`);
    console.log(`  P99:         ${p99.toFixed(2)}ms`);
    console.log(`  Max:         ${max.toFixed(2)}ms`);
    console.log(`  Total (${NUM_QUERIES} queries): ${durations.reduce((s, d) => s + d, 0).toFixed(1)}ms`);

    // Correctness sanity check: query with itself should give distance ~0
    const testId = "doc-0";
    const testVec = vectors.get(testId)!;
    const selfResult = bruteForceTopK(testVec, vectors, 1);
    console.log(`\nSanity check: self-query distance = ${selfResult[0].distance.toFixed(6)} (should be ~0)`);
    console.log(`  Self-query id = ${selfResult[0].id} (should be ${testId})`);
}

runBenchmark();
