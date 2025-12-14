import { useCallback } from 'react';
import { useAppDispatch } from './useRedux';
import { appSlice } from '@/state';

/**
 * Hook for handling panel close action consistently across all panel components.
 * Eliminates duplication of handleClose callback implementations.
 */
export const usePanelClose = () => {
    const dispatch = useAppDispatch();
    return useCallback(() => dispatch(appSlice.actions.closePanel()), [dispatch]);
};
