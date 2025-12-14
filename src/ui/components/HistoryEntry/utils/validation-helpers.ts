import { MAX_NAME_LENGTH, MAX_DESC_LENGTH } from '@/ui/components/HistoryEntry/types';

export function trimToMaxLength(value: string, maxLength: number): string {
    return value.trim().slice(0, maxLength);
}

export function trimName(value: string): string {
    return trimToMaxLength(value, MAX_NAME_LENGTH);
}

export function trimDescription(value: string): string {
    return trimToMaxLength(value, MAX_DESC_LENGTH);
}

export function hasChanged(currentValue: string, newValue: string): boolean {
    return currentValue !== newValue;
}
