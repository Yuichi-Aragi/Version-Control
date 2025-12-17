import * as v from 'valibot';
import { freeze } from 'immer';

export class ValidationError extends Error {
    readonly field: string | undefined;
    readonly issues: readonly v.BaseIssue<unknown>[] | undefined;
    readonly context: Readonly<Record<string, unknown>> | undefined;
    readonly recoverable: boolean;

    constructor(
        message: string,
        field?: string,
        issuesOrContext?: readonly v.BaseIssue<unknown>[] | Record<string, unknown>,
        recoverable: boolean = true
    ) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        
        if (Array.isArray(issuesOrContext)) {
            this.issues = freeze([...issuesOrContext], true);
        } else if (issuesOrContext) {
            this.context = freeze({ ...issuesOrContext }, true);
        }
        
        this.recoverable = recoverable;
        Object.freeze(this);
    }
}

export class SecurityError extends Error {
    readonly severity: 'low' | 'medium' | 'high';
    readonly operation: string;

    constructor(message: string, operation: string, severity: 'low' | 'medium' | 'high' = 'medium') {
        super(message);
        this.name = 'SecurityError';
        this.severity = severity;
        this.operation = operation;
        Object.freeze(this);
    }
}

export class StateConsistencyError extends Error {
    readonly context: Readonly<Record<string, unknown>> | undefined;
    readonly canRecover: boolean;

    constructor(message: string, context?: Record<string, unknown>, canRecover: boolean = false) {
        super(message);
        this.name = 'StateConsistencyError';
        this.context = context !== undefined ? freeze({ ...context }, true) : undefined;
        this.canRecover = canRecover;
        Object.freeze(this);
    }
}

export class IntegrityError extends Error {
    readonly expectedHash: string;
    readonly actualHash: string;
    readonly severity: 'warning' | 'error' | 'critical';
    readonly context: Readonly<Record<string, unknown>> | undefined;

    constructor(
        message: string, 
        expectedHash: string, 
        actualHash: string, 
        severityOrContext: 'warning' | 'error' | 'critical' | Record<string, unknown> = 'error'
    ) {
        super(message);
        this.name = 'IntegrityError';
        this.expectedHash = expectedHash;
        this.actualHash = actualHash;
        
        if (typeof severityOrContext === 'string') {
            this.severity = severityOrContext;
        } else {
            this.severity = 'error';
            this.context = freeze({ ...severityOrContext }, true);
        }
        Object.freeze(this);
    }
}

export class OperationTimeoutError extends Error {
    readonly operationName: string;
    readonly timeoutMs: number;
    readonly stage: 'queue' | 'execution' | 'commit';

    constructor(operationName: string, timeoutMs: number, stage: 'queue' | 'execution' | 'commit' = 'execution') {
        super(`Operation '${operationName}' timed out after ${timeoutMs}ms during ${stage}`);
        this.name = 'OperationTimeoutError';
        this.operationName = operationName;
        this.timeoutMs = timeoutMs;
        this.stage = stage;
        Object.freeze(this);
    }
}

export class CapacityError extends Error {
    readonly resource: string;
    readonly current: number;
    readonly limit: number;
    readonly unit: string;

    constructor(
        message: string,
        resource: string,
        current: number,
        limit: number,
        unit: string = 'bytes'
    ) {
        super(message);
        this.name = 'CapacityError';
        this.resource = resource;
        this.current = current;
        this.limit = limit;
        this.unit = unit;
        Object.freeze(this);
    }
}

export class ConcurrencyError extends Error {
    readonly conflictingOperation: string;
    readonly resource: string;
    readonly retryable: boolean;

    constructor(
        message: string,
        conflictingOperation: string,
        resource: string,
        retryable: boolean = true
    ) {
        super(message);
        this.name = 'ConcurrencyError';
        this.conflictingOperation = conflictingOperation;
        this.resource = resource;
        this.retryable = retryable;
        Object.freeze(this);
    }
}

// --- New Error Types for Reconstruction Service ---

export class CircularReferenceError extends Error {
    readonly context: Readonly<Record<string, unknown>> | undefined;
    constructor(message: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'CircularReferenceError';
        this.context = context ? freeze({ ...context }, true) : undefined;
        Object.freeze(this);
    }
}

export class ChainLengthError extends Error {
    readonly context: Readonly<Record<string, unknown>> | undefined;
    constructor(message: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'ChainLengthError';
        this.context = context ? freeze({ ...context }, true) : undefined;
        Object.freeze(this);
    }
}

export class MissingEditError extends Error {
    readonly context: Readonly<Record<string, unknown>> | undefined;
    constructor(message: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'MissingEditError';
        this.context = context ? freeze({ ...context }, true) : undefined;
        Object.freeze(this);
    }
}

export class BrokenChainError extends Error {
    readonly context: Readonly<Record<string, unknown>> | undefined;
    constructor(message: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'BrokenChainError';
        this.context = context ? freeze({ ...context }, true) : undefined;
        Object.freeze(this);
    }
}

export class ReconstructionError extends Error {
    readonly context: Readonly<Record<string, unknown>> | undefined;
    constructor(message: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'ReconstructionError';
        this.context = context ? freeze({ ...context }, true) : undefined;
        Object.freeze(this);
    }
}

export function isRecoverableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    if (error instanceof ValidationError) return error.recoverable;
    if (error instanceof StateConsistencyError) return error.canRecover;
    if (error instanceof ConcurrencyError) return error.retryable;
    if (error instanceof OperationTimeoutError) return true;
    if (error instanceof CapacityError) return false;
    if (error instanceof SecurityError) return error.severity !== 'high';
    if (error instanceof IntegrityError) return error.severity !== 'critical';

    return false;
}

export function getErrorRecoveryStrategy(error: unknown): {
    retry: boolean;
    delayMs: number;
    maxAttempts: number;
    requiresCleanup: boolean;
} {
    if (!(error instanceof Error)) {
        return { retry: false, delayMs: 0, maxAttempts: 0, requiresCleanup: false };
    }

    if (error instanceof ConcurrencyError) {
        return { retry: true, delayMs: 100, maxAttempts: 5, requiresCleanup: false };
    }

    if (error instanceof OperationTimeoutError) {
        return { retry: true, delayMs: 50, maxAttempts: 3, requiresCleanup: false };
    }

    if (error instanceof StateConsistencyError) {
        return { retry: error.canRecover, delayMs: 200, maxAttempts: 2, requiresCleanup: true };
    }

    if (error instanceof ValidationError) {
        return { retry: false, delayMs: 0, maxAttempts: 0, requiresCleanup: false };
    }

    if (error.name.includes('QuotaExceeded') || error.message.includes('quota')) {
        return { retry: false, delayMs: 0, maxAttempts: 0, requiresCleanup: true };
    }

    return { retry: true, delayMs: 1000, maxAttempts: 2, requiresCleanup: false };
}

export function createErrorContext(error: unknown): Record<string, unknown> {
    if (!(error instanceof Error)) return { type: 'unknown' };

    const context: Record<string, unknown> = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
    };

    if (error instanceof ValidationError) {
        context['field'] = error.field;
        context['recoverable'] = error.recoverable;
        if (error.issues) context['issues'] = error.issues;
        if (error.context) context['context'] = error.context;
    } else if (error instanceof SecurityError) {
        context['severity'] = error.severity;
        context['operation'] = error.operation;
    } else if (error instanceof StateConsistencyError) {
        context['canRecover'] = error.canRecover;
        context['customContext'] = error.context;
    } else if (error instanceof IntegrityError) {
        context['severity'] = error.severity;
        context['expectedHash'] = error.expectedHash;
        context['actualHash'] = error.actualHash;
        if (error.context) context['context'] = error.context;
    } else if (error instanceof OperationTimeoutError) {
        context['operationName'] = error.operationName;
        context['timeoutMs'] = error.timeoutMs;
        context['stage'] = error.stage;
    } else if (error instanceof CapacityError) {
        context['resource'] = error.resource;
        context['current'] = error.current;
        context['limit'] = error.limit;
    } else if (error instanceof ConcurrencyError) {
        context['conflictingOperation'] = error.conflictingOperation;
        context['resource'] = error.resource;
        context['retryable'] = error.retryable;
    } else if (
        error instanceof CircularReferenceError ||
        error instanceof ChainLengthError ||
        error instanceof MissingEditError ||
        error instanceof BrokenChainError ||
        error instanceof ReconstructionError
    ) {
        if (error.context) context['context'] = error.context;
    }

    return freeze(context, true);
}
