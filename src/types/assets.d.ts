declare module "*.wasm" {
    const source: string;
    export default source;
}

declare module "*.md" {
    const source: string;
    export default source;
}

declare module "*?worker-source" {
    const source: string;
    export default source;
}
