import { type RefObject, useEffect } from 'react';

/**
 * Hook for delayed focus on an element, commonly used for auto-focusing
 * inputs after a component mounts or a modal opens.
 * 
 * @param elementRef - Reference to the element to focus
 * @param delay - Delay in milliseconds before focusing (default: 50ms)
 * @param condition - Optional condition that must be true to trigger focus
 */
export const useDelayedFocus = <T extends HTMLElement>(
    elementRef: RefObject<T | null>,
    delay: number = 50,
    condition: boolean = true
) => {
    useEffect(() => {
        if (!condition) return;
        
        const timer = setTimeout(() => {
            try {
                elementRef.current?.focus();
                // If it's an input element, select its content
                if (elementRef.current instanceof HTMLInputElement) {
                    elementRef.current.select();
                }
            } catch {
                // Ignore focus errors (element may not be focusable)
            }
        }, delay);
        
        return () => clearTimeout(timer);
    }, [elementRef, delay, condition]);
};
