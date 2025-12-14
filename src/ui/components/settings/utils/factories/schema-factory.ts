import * as v from 'valibot';
import { SchemaCache } from '@/ui/components/settings/utils/helpers/schema-cache';
import { validateBounds } from '@/ui/components/settings/utils/helpers/common-utils';

export const getNumberSchema = (min: number, max: number) => {
    // Validate bounds first (fail-fast)
    validateBounds(min, max);

    const cacheKey = `number:${min}:${max}`;
    const cache = SchemaCache.getInstance();
    const cached = cache.get(cacheKey);

    if (cached) return cached;

    const schema = v.pipe(
        v.number(),
        v.minValue(min, `Must be at least ${min}`),
        v.maxValue(max, `Must be at most ${max}`),
        v.finite('Must be a finite number')
    );

    cache.set(cacheKey, schema);
    return schema;
};

export const getStringSchema = (maxLength?: number) => {
    const cacheKey = `string:${maxLength ?? 'unlimited'}`;
    const cache = SchemaCache.getInstance();
    const cached = cache.get(cacheKey);

    if (cached) return cached;

    let schema;
    if (maxLength !== undefined) {
        if (!Number.isFinite(maxLength) || maxLength < 1) {
            throw new RangeError('maxLength must be a finite positive number');
        }
        schema = v.pipe(
            v.string(),
            v.minLength(1, 'String cannot be empty'),
            v.maxLength(maxLength, `Must be at most ${maxLength} characters`)
        );
    } else {
        schema = v.pipe(
            v.string(),
            v.minLength(1, 'String cannot be empty')
        );
    }

    cache.set(cacheKey, schema);
    return schema;
};
