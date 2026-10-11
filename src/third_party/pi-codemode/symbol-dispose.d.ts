declare global {
    interface SymbolConstructor {
        readonly dispose: unique symbol;
    }
}
