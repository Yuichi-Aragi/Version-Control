import { CONFIG } from '@/workers/edit-history/config';

export class HashService {
    private static readonly encoder = new TextEncoder();

    static async computeHash(content: string): Promise<string> {
        const data = this.encoder.encode(content);
        const hashBuffer = await crypto.subtle.digest(CONFIG.HASH_ALGORITHM, data);
        const hashArray = new Uint8Array(hashBuffer);
        let hex = '';
        for (let i = 0; i < hashArray.length; i++) {
            hex += hashArray[i]!.toString(16).padStart(2, '0');
        }
        return hex;
    }

    static async verifyIntegrity(content: string, expectedHash: string): Promise<boolean> {
        if (!expectedHash || expectedHash.length === 0) {
            return true;
        }
        const actualHash = await this.computeHash(content);
        return actualHash === expectedHash;
    }
}
