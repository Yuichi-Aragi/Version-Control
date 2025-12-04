import { type FC, memo } from 'react';
import { useController, type Control, type FieldValues, type Path } from 'react-hook-form';
import clsx from 'clsx';

interface ValidationTooltipProps {
    message?: string;
}

const ValidationTooltip: FC<ValidationTooltipProps> = memo(({ message }) => {
    if (!message) return null;
    return (
        <div className="v-validation-tooltip" role="alert">
            {message}
        </div>
    );
});
ValidationTooltip.displayName = 'ValidationTooltip';

interface ValidatedInputProps<T extends FieldValues> {
    name: Path<T>;
    control: Control<T>;
    placeholder?: string;
    type?: 'text' | 'number';
    maxLength?: number;
    disabled?: boolean;
    className?: string;
}

export const ValidatedInput = <T extends FieldValues>({
    name,
    control,
    placeholder,
    type = 'text',
    maxLength,
    disabled,
    className
}: ValidatedInputProps<T>) => {
    const {
        field,
        fieldState: { invalid, isTouched, error }
    } = useController({
        name,
        control
    });

    const isValid = isTouched && !invalid;
    const isInvalid = invalid; // Show error immediately if invalid, even if not touched (for initial load validation if needed, though usually on interaction)

    return (
        <div className={clsx("v-input-validation-wrapper", { "is-valid": isValid, "is-invalid": isInvalid })}>
            {isInvalid && error?.message && <ValidationTooltip message={error.message} />}
            <input
                {...field}
                type={type}
                placeholder={placeholder}
                maxLength={maxLength}
                disabled={disabled}
                className={className}
                aria-invalid={isInvalid}
                // Ensure value is never null/undefined for controlled input
                value={field.value ?? ''} 
            />
        </div>
    );
};

interface ValidatedTextareaProps<T extends FieldValues> {
    name: Path<T>;
    control: Control<T>;
    placeholder?: string;
    rows?: number;
    maxLength?: number;
    disabled?: boolean;
    className?: string;
}

export const ValidatedTextarea = <T extends FieldValues>({
    name,
    control,
    placeholder,
    rows = 3,
    maxLength,
    disabled,
    className
}: ValidatedTextareaProps<T>) => {
    const {
        field,
        fieldState: { invalid, isTouched, error }
    } = useController({
        name,
        control
    });

    const isValid = isTouched && !invalid;
    const isInvalid = invalid;

    return (
        <div className={clsx("v-input-validation-wrapper", { "is-valid": isValid, "is-invalid": isInvalid })}>
            {isInvalid && error?.message && <ValidationTooltip message={error.message} />}
            <textarea
                {...field}
                rows={rows}
                placeholder={placeholder}
                maxLength={maxLength}
                disabled={disabled}
                className={clsx("v-settings-textarea", className)}
                aria-invalid={isInvalid}
                value={field.value ?? ''}
            />
        </div>
    );
};
