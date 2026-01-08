import { type FC, useEffect } from 'react';
import { useAppDispatch } from '@/ui/hooks';
import type { AppError } from '@/types';
import { thunks } from '@/state';
import { Icon } from '@/ui/components';

interface ErrorDisplayProps {
    error: AppError;
}

export const ErrorDisplay: FC<ErrorDisplayProps> = ({ error }) => {
    const dispatch = useAppDispatch();

    const handleRetry = () => {
        dispatch(thunks.initializeView());
    };

    useEffect(() => {
        // Automatically retry initialization after a short delay.
        // This ensures that if the failure was due to a transient state (e.g., "Not ready"),
        // the view will eventually recover without user intervention.
        const retryTimer = setTimeout(() => {
            handleRetry();
        }, 3000); // Retry every 3 seconds

        return () => clearTimeout(retryTimer);
    }, [dispatch]);

    return (
        <div className="v-placeholder v-error-display">
            <div className="v-placeholder-icon">
                <Icon name="alert-triangle" />
            </div>
            <h3>{error.title}</h3>
            <p className="v-meta-label">{error.message}</p>
            {error.details && (
                <pre className="v-error-details">{error.details}</pre>
            )}
            <div className="v-error-actions">
                <p className="v-meta-label v-retry-message">Retrying automatically...</p>
                <button
                    className="mod-cta"
                    aria-label="Retry initializing the version control view"
                    onClick={handleRetry}
                >
                    Retry Now
                </button>
            </div>
        </div>
    );
};
