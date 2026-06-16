export interface TopKResult {
    id: number;
    distance: number;
}

export function cosineDistance(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 1;
    return 1 - dot / denom;
}

export function l2Distance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}

export function bruteForceTopK(
    queryVec: Float32Array,
    cache: Map<number, Float32Array>,
    k: number,
    metric: "COSINE" | "L2" = "COSINE",
): TopKResult[] {
    if (k <= 0 || cache.size === 0) return [];

    const distFn = metric === "COSINE" ? cosineDistance : l2Distance;
    const effectiveK = Math.min(k, cache.size);

    // Max-heap of size k: the root is the largest distance so far,
    // allowing O(1) eviction of the worst candidate.
    const heap: TopKResult[] = [];

    for (const [id, vec] of cache) {
        const distance = distFn(queryVec, vec);
        if (heap.length < effectiveK) {
            heap.push({ id, distance });
            if (heap.length === effectiveK) {
                heapify(heap);
            }
        } else if (distance < heap[0].distance) {
            heap[0] = { id, distance };
            siftDown(heap, 0);
        }
    }

    heap.sort((a, b) => a.distance - b.distance);
    return heap;
}

function heapify(heap: TopKResult[]): void {
    for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
        siftDown(heap, i);
    }
}

function siftDown(heap: TopKResult[], i: number): void {
    const n = heap.length;
    while (true) {
        let largest = i;
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        if (left < n && heap[left].distance > heap[largest].distance) {
            largest = left;
        }
        if (right < n && heap[right].distance > heap[largest].distance) {
            largest = right;
        }
        if (largest === i) break;
        const tmp = heap[i];
        heap[i] = heap[largest];
        heap[largest] = tmp;
        i = largest;
    }
}
