export function openDesktopWindow(app: any): void {
    app.workspace.getLeaf("window"); // platform-guarded
}
