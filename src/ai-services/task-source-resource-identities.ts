export interface TaskSourceResourceIdentity {
    readonly resourceRef: string;
    readonly path: string;
    readonly kind: "file" | "folder";
}

interface RegisteredResource {
    identity: TaskSourceResourceIdentity;
    readonly object: object;
    invalidated: boolean;
}

export interface TaskSourceResourceIdentitiesHost {
    runId: string;
    getAbstractFileByPath(path: string): unknown;
}

/** Run-local general resource identities; permissions remain with TaskSourceRun. */
export class TaskSourceResourceIdentities {
    private readonly byRef = new Map<string, RegisteredResource>();
    private readonly byPath = new Map<string, RegisteredResource>();
    private readonly byObject = new WeakMap<object, RegisteredResource>();
    private nextIdentity = 0;
    private readonly referencePrefix = [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('');

    constructor(private readonly host: TaskSourceResourceIdentitiesHost) {}

    register(value: unknown, knownPath?: string): TaskSourceResourceIdentity | undefined {
        if (!value || typeof value !== "object") return undefined;
        const candidate = value as { path?: unknown; children?: unknown };
        if (typeof candidate.path !== "string" || (!candidate.path && !Array.isArray(candidate.children))) return undefined;
        const path = candidate.path;
        if (knownPath !== undefined && knownPath !== path) return undefined;
        const kind = candidate.children !== undefined ? "folder" : "file";
        const live = this.host.getAbstractFileByPath(path);
        if (live !== value) return undefined;

        const existing = this.byObject.get(value) ?? this.byPath.get(path);
        if (existing) {
            if (this.isLive(existing) && existing.object === value) {
                return existing.identity;
            }
            this.byPath.delete(path);
        }

        // A dead old object at this path must not hide explicit rediscovery of a
        // new object. The old ref and all versions derived from it stay invalid.
        const sequence = ++this.nextIdentity;
        const identity = Object.freeze({
            resourceRef: `res_${this.referencePrefix}_${sequence}`,
            path,
            kind,
        });
        const registered: RegisteredResource = { identity, object: value, invalidated: false };
        this.byRef.set(identity.resourceRef, registered);
        this.byPath.set(path, registered);
        this.byObject.set(value, registered);
        return identity;
    }

    resolve(resourceRef: string): TaskSourceResourceIdentity | undefined {
        const registered = this.byRef.get(resourceRef);
        return registered && this.isLive(registered) ? registered.identity : undefined;
    }

    /** Historical path for an already admitted read; never an executable target. */
    snapshotPathFor(resourceRef: string): string | undefined {
        const registered = this.byRef.get(resourceRef);
        if (!registered) return undefined;
        const path = (registered.object as { path?: unknown }).path;
        return typeof path === "string" ? path : undefined;
    }

    objectFor(resourceRef: string): object | undefined {
        const registered = this.byRef.get(resourceRef);
        return registered && this.isLive(registered) ? registered.object : undefined;
    }

    move(resourceRef: string, nextPath: string, expectedObject?: object): boolean {
        const registered = this.byRef.get(resourceRef);
        if (!registered || !this.isLive(registered)) return false;
        if (expectedObject !== undefined && registered.object !== expectedObject) return false;
        if ((registered.object as { path?: string }).path !== nextPath
            || this.host.getAbstractFileByPath(nextPath) !== registered.object) return false;
        this.byPath.delete(registered.identity.path);
        registered.identity = Object.freeze({ ...registered.identity, path: nextPath });
        this.byPath.set(nextPath, registered);
        return true;
    }

    private isLive(registered: RegisteredResource): boolean {
        if (registered.invalidated) return false;
        try {
            const path = (registered.object as { path?: unknown }).path;
            if (typeof path !== 'string') {
                registered.invalidated = true;
                return false;
            }
            const current = this.host.getAbstractFileByPath(path);
            if (current !== registered.object) {
                registered.invalidated = true;
                return false;
            }
            if (path !== registered.identity.path) {
                if (this.byPath.get(registered.identity.path) === registered) this.byPath.delete(registered.identity.path);
                registered.identity = Object.freeze({ ...registered.identity, path });
                this.byPath.set(path, registered);
            }
            return true;
        } catch {
            registered.invalidated = true;
            return false;
        }
    }
}
