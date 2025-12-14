import * as v from 'valibot';

export class ValidationError extends Error {
    readonly field: string | undefined;
    readonly issues: readonly v.BaseIssue<unknown>[] | undefined;

    constructor(message: string, field?: string, issues?: readonly v.BaseIssue<unknown>[]) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        this.issues = issues ? Object.freeze([...issues]) : undefined;
        Object.freeze(this);
    }
}

export class SecurityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SecurityError';
        Object.freeze(this);
    }
}

export class StateConsistencyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'StateConsistencyError';
        Object.freeze(this);
    }
}

export class IntegrityError extends Error {
    readonly expectedHash: string;
    readonly actualHash: string;

    constructor(message: string, expectedHash: string, actualHash: string) {
        super(message);
        this.name = 'IntegrityError';
        this.expectedHash = expectedHash;
        this.actualHash = actualHash;
        Object.freeze(this);
    }
}
