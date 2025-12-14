import * as v from 'valibot';
import { ValidationError } from '@/workers/edit-history/errors';

export * from './schemas';

export function validateInput<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
    schema: TSchema,
    input: unknown,
    fieldName: string
): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, input);
    if (!result.success) {
        const messages = result.issues.map((i) => i.message).join('; ');
        throw new ValidationError(`Invalid ${fieldName}: ${messages}`, fieldName, result.issues);
    }
    return result.output;
}
