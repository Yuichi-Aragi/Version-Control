const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 100;

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = MAX_RETRY_ATTEMPTS,
  baseDelayMs: number = RETRY_BASE_DELAY_MS,
  shouldRetry: (error: unknown, attempt: number) => boolean = () => true
): Promise<T> {
  let lastError: unknown;
  let attempt = 1;
  
  while (attempt <= maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      
      const jitter = Math.random() * 0.3 + 0.85;
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const delay = Math.min(exponentialDelay * jitter, 5000);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }
  
  throw lastError;
}
