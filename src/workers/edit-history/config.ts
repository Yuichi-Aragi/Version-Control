import { freeze } from 'immer';

export const CONFIG = freeze({
    MAX_CHAIN_LENGTH: 50,
    DIFF_SIZE_THRESHOLD: 0.8,
    DB_NAME: 'VersionControlEditHistoryDB',
    COMPRESSION_LEVEL: 9,
    MAX_CONTENT_SIZE: 50 * 1024 * 1024,
    MAX_ID_LENGTH: 255,
    MAX_RETRIES: 3,
    RETRY_BASE_DELAY_MS: 10,
    HASH_ALGORITHM: 'SHA-256'
} as const);
