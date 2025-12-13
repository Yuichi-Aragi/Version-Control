import { MAX_RETRY_ATTEMPTS, RETRY_DELAY_MS } from '@/core/tasks/cleanup-manager/config';

export async function retryOperation<T>(
  operation: () => Promise<T>,
  errorMessage: string,
  attempts: number = MAX_RETRY_ATTEMPTS
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  console.error(`VC: ${errorMessage} after ${attempts} attempts.`, lastError);
  throw lastError || new Error(errorMessage);
}
