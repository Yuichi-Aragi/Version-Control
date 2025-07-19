import { diffLines, type Change } from 'diff';
import { isString } from 'lodash-es';

// Define message interfaces for strong typing
interface DiffWorkerRequest {
    requestId: string;
    content1: string;
    content2: string;
}

interface DiffWorkerSuccessResponse {
    status: 'success';
    requestId: string;
    changes: Change[];
}

interface DiffWorkerErrorResponse {
    status: 'error';
    requestId: string;
    error: {
        message: string;
        stack?: string;
    };
}

type DiffWorkerResponse = DiffWorkerSuccessResponse | DiffWorkerErrorResponse;


// This is a self-contained web worker.
// It listens for messages, performs the CPU-intensive diff, and posts the result back.

self.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
    const { requestId, content1, content2 } = event.data;
    try {
        if (!isString(content1) || !isString(content2)) {
            throw new Error("Worker received invalid data type for diffing.");
        }

        // The core synchronous, CPU-intensive operation.
        const changes = diffLines(content1, content2, { newlineIsToken: true });

        // Post the result back to the main thread with the request ID.
        const response: DiffWorkerSuccessResponse = {
            status: 'success',
            requestId,
            changes,
        };
        self.postMessage(response);

    } catch (error) {
        // If an error occurs, post an error message back with the request ID.
        const stack = error instanceof Error ? error.stack : undefined;
        const response: DiffWorkerErrorResponse = {
            status: 'error',
            requestId,
            error: {
                message: error instanceof Error ? error.message : String(error),
                // FIX: Conditionally add the 'stack' property only if it exists.
                // This satisfies the 'exactOptionalPropertyTypes' compiler option by ensuring
                // 'stack' is either a string or the property is omitted, but never explicitly undefined.
                ...(stack && { stack }),
            }
        };
        self.postMessage(response);
    }
};
