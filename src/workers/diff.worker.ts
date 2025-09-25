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

// Worker global context type assertion for better TypeScript support
declare const self: WorkerGlobalScope;

// Input validation utility
function validateWorkerRequest(data: unknown): asserts data is DiffWorkerRequest {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid request format: expected object');
    }
    
    const request = data as Partial<DiffWorkerRequest>;
    
    if (typeof request.requestId !== 'string' || request.requestId.trim() === '') {
        throw new Error('Invalid request: requestId must be a non-empty string');
    }
    
    if (!isString(request.content1)) {
        throw new Error('Invalid request: content1 must be a string');
    }
    
    if (!isString(request.content2)) {
        throw new Error('Invalid request: content2 must be a string');
    }
}

// Safe postMessage wrapper with error handling
function safePostMessage(response: DiffWorkerResponse): void {
    try {
        // Validate response structure before posting
        if (!response || typeof response !== 'object') {
            throw new Error('Cannot post invalid response');
        }
        
        if (typeof response.status !== 'string' || !['success', 'error'].includes(response.status)) {
            throw new Error('Invalid response status');
        }
        
        if (typeof response.requestId !== 'string' || response.requestId.trim() === '') {
            throw new Error('Invalid requestId in response');
        }
        
        self.postMessage(response);
    } catch (postError) {
        console.error('Version Control: Failed to post message to main thread', postError);
        // Attempt to send minimal error notification if possible
        try {
            const fallbackRequestId = (response as any)?.requestId || 'unknown';
            self.postMessage({
                status: 'error',
                requestId: fallbackRequestId,
                error: {
                    message: `Failed to send response: ${postError instanceof Error ? postError.message : 'Unknown error'}`
                }
            } as DiffWorkerErrorResponse);
        } catch (fallbackError) {
            console.error('Version Control: Failed to send fallback error message', fallbackError);
        }
    }
}

// Main worker message handler
self.onmessage = (event: MessageEvent) => {
    try {
        // Validate the event and its data
        if (!event || !('data' in event)) {
            throw new Error('Received invalid message event');
        }

        // Validate request structure
        validateWorkerRequest(event.data);
        
        const { requestId, content1, content2 } = event.data as DiffWorkerRequest;
        
        // Perform the CPU-intensive diff operation
        let changes: Change[];
        try {
            changes = diffLines(content1, content2, { 
                newlineIsToken: true,
            });
        } catch (diffError) {
            throw new Error(`Diff calculation failed: ${diffError instanceof Error ? diffError.message : 'Unknown error'}`);
        }
        
        // Validate output
        if (!Array.isArray(changes)) {
            throw new Error('Diff algorithm returned invalid result format');
        }
        
        // Create and send success response
        const response: DiffWorkerSuccessResponse = {
            status: 'success',
            requestId,
            changes
        };
        
        safePostMessage(response);
        
    } catch (error) {
        // Create comprehensive error response
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        const response: DiffWorkerErrorResponse = {
            status: 'error',
            requestId: (event?.data as any)?.requestId || 'unknown',
            error: {
                message: errorMessage,
                ...(errorStack ? { stack: errorStack } : {})
            }
        };
        
        safePostMessage(response);
    }
};

// Handle uncaught errors in the worker
self.onerror = (error: ErrorEvent) => {
    console.error('Version Control: Uncaught error in diff worker', {
        message: error.message,
        filename: error.filename,
        lineno: error.lineno,
        colno: error.colno,
        error: error.error
    });
    
    // Try to notify main thread if we have a requestId context
    // Note: This is best-effort since we may not have the requestId
    try {
        self.postMessage({
            status: 'error',
            requestId: 'unknown',
            error: {
                message: `Uncaught worker error: ${error.message}`,
                stack: error.error?.stack || `${error.filename}:${error.lineno}:${error.colno}`
            }
        } as DiffWorkerErrorResponse);
    } catch (e) {
        console.error('Version Control: Failed to report uncaught error', e);
    }
};

// Graceful shutdown handling
self.addEventListener('close', () => {
    console.debug('Version Control: Diff worker shutting down gracefully');
});