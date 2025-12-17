import { freeze } from 'immer';

export const CONFIG = freeze({
    // Base configuration
    MAX_CHAIN_LENGTH: 50,
    DIFF_SIZE_THRESHOLD: 0.8,
    DB_NAME: 'VersionControlEditHistoryDB',
    COMPRESSION_LEVEL: 9,
    MAX_CONTENT_SIZE: 50 * 1024 * 1024,
    MAX_ID_LENGTH: 255,
    MAX_RETRIES: 3,
    RETRY_BASE_DELAY_MS: 10,
    HASH_ALGORITHM: 'SHA-256',

    // Dynamic Chain Limit Thresholds
    CHAIN_THRESHOLDS: freeze({
        SMALL_SIZE_LIMIT: 10 * 1024,
        MEDIUM_SIZE_LIMIT: 50 * 1024,
        SMALL_CHAIN_LENGTH: 50,
        MEDIUM_CHAIN_LENGTH: 10,
        LARGE_CHAIN_LENGTH: 1
    }, true)
}, true);

export type Config = typeof CONFIG;
