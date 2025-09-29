import type { FC } from 'react';
import { useAppDispatch } from '../hooks/useRedux';
import type { AppError } from '../../types';
import { thunks } from '../../state/thunks';
import { Icon } from './Icon';

interface ErrorDisplayProps {
    error: AppError;
}

export const ErrorDisplay: FC<ErrorDisplayProps> = ({ error }) => {
    const dispatch = useAppDispatch();

    const handleRetry = () => {
        dispatch(thunks.initializeView());
    };

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
            <button
                className="mod-cta"
                aria-label="Retry initializing the version control view"
                onClick={handleRetry}
            >
                Retry initialization
            </button>
        </div>
    );
};
