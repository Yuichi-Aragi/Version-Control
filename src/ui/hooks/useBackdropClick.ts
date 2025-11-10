import { useCallback, type MouseEvent } from 'react';

/**
 * Hook for handling backdrop click-to-close functionality.
 * Returns a callback that only triggers the onClose handler if the backdrop
 * (not a child element) was clicked.
 * 
 * @param onClose - Function to call when backdrop is clicked
 * @returns Click handler for the backdrop container
 */
export const useBackdropClick = (onClose: () => void) => {
    return useCallback((e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [onClose]);
};
