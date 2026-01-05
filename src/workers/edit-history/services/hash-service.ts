import { Dexie } from 'dexie';
import { CONFIG } from '@/workers/edit-history/config';

export class HashService {
    private static readonly encoder = new TextEncoder();

    static async computeHash(content: string): Promise<string> {
        // Caching removed to prevent collisions and ensure data integrity.
        // Modern crypto.subtle is sufficiently fast for typical note sizes.
        const data = this.encoder.encode(content);
        
        // Wrap native promise in Dexie.waitFor to prevent transaction commit issues
        const hashBuffer = await Dexie.waitFor(crypto.subtle.digest(CONFIG.HASH_ALGORITHM, data));
        
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    static async verifyIntegrity(content: string, expectedHash: string): Promise<boolean> {
        if (!expectedHash || expectedHash.length === 0) {
            return true;
        }

        if (expectedHash.length !== 64) {
            return false;
        }

        const actualHash = await this.computeHash(content);
        return actualHash === expectedHash;
    }

    static async computeHashWithSalt(content: string, salt: string): Promise<string> {
        const saltedContent = content + salt;
        return this.computeHash(saltedContent);
    }

    static async verifyIntegrityWithSalt(
        content: string,
        expectedHash: string,
        salt: string
    ): Promise<boolean> {
        const saltedHash = await this.computeHashWithSalt(content, salt);
        return saltedHash === expectedHash;
    }

    static validateHashFormat(hash: string): boolean {
        return /^[a-f0-9]{64}$/i.test(hash);
    }

    static async computeBatchHashes(contents: string[]): Promise<string[]> {
        const results: string[] = [];
        
        for (const content of contents) {
            results.push(await this.computeHash(content));
        }
        
        return results;
    }

    static clearCache(): void {
        // No-op as cache is removed
    }
}
