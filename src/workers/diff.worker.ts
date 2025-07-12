import { diffLines } from 'diff';
import { isString } from 'lodash-es';

// This is a self-contained web worker.
// It listens for messages, performs the CPU-intensive diff, and posts the result back.

self.onmessage = (event: MessageEvent<{ content1: string; content2: string }>) => {
    try {
        const { content1, content2 } = event.data;
        
        if (!isString(content1) || !isString(content2)) {
            throw new Error("Worker received invalid data type for diffing.");
        }

        // The core synchronous, CPU-intensive operation, now safely off the main thread.
        const changes = diffLines(content1, content2, { newlineIsToken: true });

        // Post the result back to the main thread
        self.postMessage({ status: 'success', changes });
    } catch (error) {
        // If an error occurs, post an error message back
        self.postMessage({ 
            status: 'error', 
            error: {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            }
        });
    }
};
