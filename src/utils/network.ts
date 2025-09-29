import { requestUrl, type RequestUrlResponse } from 'obsidian';

export interface RetryOptions {
    retries: number;
    delay: number; // initial delay in ms
    maxDelay: number; // max delay in ms
    jitter: boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
    retries: 3,
    delay: 500,
    maxDelay: 5000,
    jitter: true,
};

/**
 * Validates retry configuration options with strict defensive checks.
 * @param options The retry options to validate
 * @returns Validated RetryOptions object
 * @throws TypeError if validation fails
 */
function validateRetryOptions(options: Partial<RetryOptions>): Required<RetryOptions> {
    // Validate retries
    if (options.retries !== undefined) {
        if (typeof options.retries !== 'number' || !Number.isInteger(options.retries) || options.retries < 0) {
            throw new TypeError('RetryOptions.retries must be a non-negative integer');
        }
    }

    // Validate delay
    if (options.delay !== undefined) {
        if (typeof options.delay !== 'number' || options.delay < 0 || !isFinite(options.delay)) {
            throw new TypeError('RetryOptions.delay must be a non-negative finite number');
        }
    }

    // Validate maxDelay
    if (options.maxDelay !== undefined) {
        if (typeof options.maxDelay !== 'number' || options.maxDelay < 0 || !isFinite(options.maxDelay)) {
            throw new TypeError('RetryOptions.maxDelay must be a non-negative finite number');
        }
        // Ensure maxDelay is not less than delay
        if (options.delay !== undefined && options.maxDelay < options.delay) {
            throw new TypeError('RetryOptions.maxDelay must be greater than or equal to delay');
        }
    } else if (options.delay !== undefined && options.delay > DEFAULT_RETRY_OPTIONS.maxDelay) {
        // If maxDelay is not provided but delay exceeds default maxDelay, adjust maxDelay accordingly
        return {
            retries: options.retries ?? DEFAULT_RETRY_OPTIONS.retries,
            delay: options.delay,
            maxDelay: options.delay,
            jitter: options.jitter ?? DEFAULT_RETRY_OPTIONS.jitter,
        };
    }

    // Validate jitter
    if (options.jitter !== undefined && typeof options.jitter !== 'boolean') {
        throw new TypeError('RetryOptions.jitter must be a boolean');
    }

    // Apply defaults and ensure all required properties are present
    const validated: Required<RetryOptions> = {
        retries: options.retries ?? DEFAULT_RETRY_OPTIONS.retries,
        delay: options.delay ?? DEFAULT_RETRY_OPTIONS.delay,
        maxDelay: options.maxDelay ?? DEFAULT_RETRY_OPTIONS.maxDelay,
        jitter: options.jitter ?? DEFAULT_RETRY_OPTIONS.jitter,
    };

    // Final validation: ensure maxDelay >= delay
    if (validated.maxDelay < validated.delay) {
        validated.maxDelay = validated.delay;
    }

    return validated;
}

/**
 * Awaits for a specified amount of time.
 * @param ms The time to wait in milliseconds.
 * @returns A promise that resolves after the specified time
 * @throws TypeError if ms is invalid
 */
function wait(ms: number): Promise<void> {
    if (typeof ms !== 'number' || ms < 0 || !isFinite(ms)) {
        throw new TypeError('Delay must be a non-negative finite number');
    }
    
    return new Promise(resolve => {
        const timeoutId = setTimeout(() => {
            resolve();
        }, ms);
        
        // Prevent potential memory leaks in long-running applications
        // by ensuring the timeout is properly managed (though setTimeout
        // is generally well-behaved in modern JS engines)
    });
}

/**
 * Safely checks if the browser has internet connectivity.
 * @returns boolean indicating online status
 */
function isOnline(): boolean {
    try {
        // navigator.onLine can be unreliable in some environments
        // but it's the best available primitive check
        return typeof navigator !== 'undefined' && navigator.onLine === true;
    } catch {
        // If navigator is not available or throws, assume online
        // as we cannot definitively determine offline status
        return true;
    }
}

/**
 * Generates a jittered delay for exponential backoff.
 * @param baseDelay The base delay in milliseconds
 * @param addJitter Whether to add jitter
 * @returns The calculated delay with optional jitter
 */
function calculateDelay(baseDelay: number, addJitter: boolean): number {
    if (!addJitter) {
        return baseDelay;
    }
    
    // Add random jitter between -50% and +50% of baseDelay
    // This prevents thundering herd problems while maintaining
    // the general exponential backoff pattern
    const jitter = (Math.random() - 0.5) * baseDelay;
    const delayed = baseDelay + jitter;
    
    // Ensure delay is never negative
    return Math.max(0, delayed);
}

/**
 * Performs a network request using `requestUrl` with a retry mechanism.
 * Implements exponential backoff with optional jitter.
 * 
 * This function is designed to be a drop-in replacement with strict
 * backward compatibility while providing enhanced reliability.
 * 
 * @param url The URL to request. Must be a valid string.
 * @param options Retry configuration options (optional)
 * @returns A promise that resolves with the response or rejects after all retries fail
 * @throws TypeError if url is invalid or options are malformed
 * @throws Error if all retry attempts fail
 */
export async function requestWithRetry(
    url: string,
    options: Partial<RetryOptions> = {}
): Promise<RequestUrlResponse> {
    // Strict input validation - proactive rather than reactive
    if (typeof url !== 'string') {
        throw new TypeError('URL must be a string');
    }
    
    if (url.trim() === '') {
        throw new TypeError('URL cannot be empty');
    }
    
    if (typeof options !== 'object' || options === null) {
        throw new TypeError('Options must be an object or undefined');
    }
    
    // Validate and normalize retry options
    const config = validateRetryOptions(options);
    
    let currentDelay = config.delay;
    let lastError: unknown = new Error('Retry mechanism initialization failed');
    
    // Use a bounded loop to prevent infinite retries
    for (let attempt = 0; attempt <= config.retries; attempt++) {
        try {
            // Proactive connectivity check
            if (!isOnline()) {
                throw new Error('No internet connection available');
            }
            
            // Execute the request
            const response = await requestUrl(url);
            
            // Defensive check: ensure response object has expected structure
            if (typeof response !== 'object' || response === null) {
                throw new Error('Invalid response format from requestUrl');
            }
            
            // Check for status property existence and validity
            if (typeof (response as any).status !== 'number') {
                throw new Error('Response missing valid status code');
            }
            
            const status = (response as any).status;
            
            // Success if status is in 2xx range
            if (status >= 200 && status < 300) {
                return response;
            }
            
            // Create specific error for non-2xx responses
            lastError = new Error(`HTTP ${status}: Request failed with non-success status code`);
            (lastError as any).statusCode = status;
            (lastError as any).attempt = attempt + 1;
            
        } catch (error) {
            lastError = error;
            (lastError as any).attempt = attempt + 1;
        }
        
        // If this was the final attempt, break and throw
        if (attempt === config.retries) {
            break;
        }
        
        // Calculate next delay with jitter
        const nextDelay = calculateDelay(currentDelay, config.jitter);
        const roundedDelay = Math.round(nextDelay);
        
        // Log retry attempt (maintain existing logging format for compatibility)
        console.warn(
            `Version Control: Attempt ${attempt + 1} to fetch ${url} failed. Retrying in ${roundedDelay}ms...`,
            lastError
        );
        
        // Wait for calculated delay
        await wait(nextDelay);
        
        // Apply exponential backoff, bounded by maxDelay
        currentDelay = Math.min(currentDelay * 2, config.maxDelay);
    }
    
    // Final error logging (maintain existing format for compatibility)
    console.error(`Version Control: Final attempt to fetch ${url} failed.`, lastError);
    
    // Ensure we always throw an Error instance for consistent error handling
    if (lastError instanceof Error) {
        throw lastError;
    } else if (typeof lastError === 'string') {
        throw new Error(lastError);
    } else {
        throw new Error('Request failed with unknown error');
    }
}
