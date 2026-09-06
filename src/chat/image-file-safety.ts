import { FileSystemAdapter, Platform, type App } from 'obsidian';
import { validateImagePath } from './image-types';

/** Destructive cleanup requires proof that every component stays in the vault. */
export async function assertImageDeletionPath(app: Pick<App, 'vault'>, relativePath: string): Promise<void> {
    validateImagePath(relativePath);
    if (!Platform.isDesktopApp || !(app.vault.adapter instanceof FileSystemAdapter)) {
        throw new Error('image_assets:cleanup_path_unverifiable');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Desktop-only module behind the platform and adapter guard.
    const fs: typeof import('node:fs/promises') = require('node:fs/promises');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Never loaded by the mobile runtime.
    const path: typeof import('node:path') = require('node:path');
    const base = await fs.realpath(app.vault.adapter.getBasePath());
    let current = base;
    const parts = relativePath.split('/');
    for (let i = 0; i < parts.length; i++) {
        current = path.join(current, parts[i]);
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
            throw new Error('image_assets:cleanup_path_unverifiable');
        }
    }
    if (!(await fs.realpath(current)).startsWith(base + path.sep)) throw new Error('image_assets:cleanup_path_unverifiable');
}
