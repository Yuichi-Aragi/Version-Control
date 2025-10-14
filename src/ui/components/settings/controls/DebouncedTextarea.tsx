import { type FC, useEffect, useRef, memo, useState, useCallback, useMemo, type ChangeEvent } from 'react';
import { debounce, type Debouncer } from 'obsidian';
import { validateString } from '../settingsUtils';

interface DebouncedTextareaProps {
    initialValue: string; 
    onFinalChange: (value: string) => void;
    onLiveChange?: (value: string) => void;
    placeholder?: string; 
    rows?: number;
    maxLength?: number;
}

export const DebouncedTextarea: FC<DebouncedTextareaProps> = memo(({ 
    initialValue, 
    onFinalChange, 
    onLiveChange,
    placeholder, 
    rows,
    maxLength = 10000
}) => {
    const [value, setValue] = useState(() => {
        try {
            return validateString(initialValue, maxLength);
        } catch (error) {
            console.error('Invalid initial textarea value:', error);
            return '';
        }
    });
    
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastCommittedValue = useRef<string>(initialValue);

    useEffect(() => { 
        try {
            const validatedValue = validateString(initialValue, maxLength);
            setValue(validatedValue);
            lastCommittedValue.current = validatedValue;
        } catch (error) {
            console.error('Invalid textarea value from props:', error);
        }
    }, [initialValue, maxLength]);

    const debouncedOnFinalChange = useMemo(() => {
        const fn = debounce((newValue: string) => {
            try {
                const validatedValue = validateString(newValue, maxLength);
                if (validatedValue !== lastCommittedValue.current) {
                    onFinalChange(validatedValue);
                    lastCommittedValue.current = validatedValue;
                }
            } catch (error) {
                console.error('Error in debounced textarea update:', error);
            }
        }, 1000);
        return fn as Debouncer<[string], void>;
    }, [onFinalChange, maxLength]);

    useEffect(() => {
        const cleanup = (): void => {
            debouncedOnFinalChange.cancel?.();
        };
        return cleanup;
    }, [debouncedOnFinalChange]);

    const adjustTextareaHeight = useCallback(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            const parent = textarea.parentElement;
            const maxHeight = parent ? parent.clientHeight / 2 : 150;
            const newHeight = Math.min(textarea.scrollHeight + 5, maxHeight);
            textarea.style.height = `${newHeight}px`;
        }
    }, []);

    useEffect(() => { 
        adjustTextareaHeight(); 
    }, [value, adjustTextareaHeight]);

    const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        try {
            const newValue = validateString(e.target.value, maxLength);
            setValue(newValue);
            onLiveChange?.(newValue);
            (debouncedOnFinalChange as unknown as ((s: string) => void))?.(newValue);
        } catch (error) {
            console.error('Invalid textarea input:', error);
        }
    }, [debouncedOnFinalChange, onLiveChange, maxLength]);

    const handleBlur = useCallback(() => {
        debouncedOnFinalChange.cancel?.();
        try {
            const validatedValue = validateString(value, maxLength);
            if (validatedValue !== lastCommittedValue.current) {
                onFinalChange(validatedValue);
                lastCommittedValue.current = validatedValue;
            }
        } catch (error) {
            console.error('Error validating textarea on blur:', error);
            setValue(lastCommittedValue.current);
        }
    }, [debouncedOnFinalChange, value, onFinalChange, maxLength]);

    return (
        <textarea 
            ref={textareaRef} 
            className="v-settings-textarea" 
            rows={rows} 
            placeholder={placeholder} 
            value={value} 
            onChange={handleChange} 
            onBlur={handleBlur}
            onFocus={adjustTextareaHeight}
            maxLength={maxLength}
            aria-label="Settings textarea"
        />
    );
});
DebouncedTextarea.displayName = 'DebouncedTextarea';
