import { freeze } from 'immer';

export class KeyedMutex {
    private readonly locks = new Map<string, Promise<void>>();
    private readonly resolvers = new Map<string, () => void>();

    async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        while (this.locks.has(key)) {
            await this.locks.get(key);
        }

        let resolver!: () => void;
        const promise = new Promise<void>((resolve) => {
            resolver = resolve;
        });

        this.locks.set(key, promise);
        this.resolvers.set(key, resolver);

        try {
            return await operation();
        } finally {
            this.locks.delete(key);
            this.resolvers.delete(key);
            resolver();
        }
    }

    get activeKeys(): readonly string[] {
        return freeze([...this.locks.keys()]);
    }
}
