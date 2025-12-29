export interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    timeout?: number;
    context?: string;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
    /**
     * Optional validation function to run after an error occurs.
     * If this returns true, the operation is considered successful despite the error.
     * Useful for handling race conditions (e.g., "folder already exists").
     */
    validateSuccess?: () => Promise<boolean>;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry' | 'validateSuccess' | 'context'>> = {
    maxRetries: 3,
    baseDelay: 100,
    maxDelay: 5000,
    timeout: 0 // 0 means no timeout
};

/**
 * Executes an operation with exponential backoff retry logic, timeout protection,
 * and optional success validation for false-positive error handling.
 */
export async function executeWithRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const config = { ...DEFAULT_OPTIONS, ...options };
    let lastError: unknown;

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
        try {
            if (config.timeout > 0) {
                return await Promise.race([
                    operation(),
                    new Promise<never>((_, reject) => 
                        setTimeout(() => reject(new Error(`Timeout: ${config.context || 'Operation timed out'}`)), config.timeout)
                    )
                ]);
            }
            return await operation();
        } catch (error) {
            lastError = error;

            // 1. Check for false positives via validation hook
            if (config.validateSuccess) {
                try {
                    if (await config.validateSuccess()) {
                        return undefined as unknown as T; // Operation effectively succeeded
                    }
                } catch (validationError) {
                    // Validation failed, proceed to retry logic
                }
            }

            // 2. Check if we should stop retrying
            const isLastAttempt = attempt > config.maxRetries;
            const shouldRetry = config.shouldRetry ? config.shouldRetry(error, attempt) : true;

            if (isLastAttempt || !shouldRetry) {
                throw error;
            }

            // 3. Wait with exponential backoff and jitter
            const jitter = Math.random() * 0.3 + 0.85;
            const exponentialDelay = config.baseDelay * Math.pow(2, attempt - 1);
            const delay = Math.min(exponentialDelay * jitter, config.maxDelay);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}
