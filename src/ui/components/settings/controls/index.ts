/**
 * Settings Controls Module
 *
 * This module provides reusable input control components for settings UIs.
 * Controls handle user input with validation, debouncing, and proper state management.
 *
 * @module ui/components/settings/controls
 *
 * ## Components
 *
 * - **DebouncedTextarea**: Textarea with debounced onChange
 * - **SliderWithInputControl**: Combined slider and numeric input
 * - **ValidatedControls**: Input controls with validation feedback
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   DebouncedTextarea,
 *   SliderWithInputControl
 * } from '@/ui/components/settings/controls';
 *
 * // Debounced textarea
 * <DebouncedTextarea
 *   value={text}
 *   onChange={handleChange}
 *   debounceMs={300}
 * />
 *
 * // Slider with input
 * <SliderWithInputControl
 *   value={interval}
 *   onChange={setInterval}
 *   min={1}
 *   max={300}
 * />
 * ```
 */

// ============================================================================
// CONTROL COMPONENTS
// ============================================================================

export { DebouncedTextarea } from './DebouncedTextarea';
export { SliderWithInputControl } from './SliderWithInputControl';
export * from './ValidatedControls';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Props for debounced input controls.
 */
export interface DebouncedInputProps<T> {
    value: T;
    onChange: (value: T) => void;
    debounceMs?: number;
    disabled?: boolean;
}

/**
 * Props for slider controls.
 */
export interface SliderControlProps {
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step?: number;
    disabled?: boolean;
    label?: string;
}

/**
 * Validation result for validated controls.
 */
export interface ValidationResult {
    isValid: boolean;
    error?: string;
}

/**
 * Props for validated input controls.
 */
export interface ValidatedInputProps<T> {
    value: T;
    onChange: (value: T) => void;
    validate: (value: T) => ValidationResult;
    disabled?: boolean;
}
