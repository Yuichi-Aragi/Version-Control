import type { FC } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { AppStatus } from '../../../state/state';
import { actions } from '../../../state/appSlice';
import type { ConfirmationPanel as ConfirmationPanelState } from '../../../state/state';

interface ConfirmationPanelProps {
    panelState: ConfirmationPanelState;
}

export const ConfirmationPanel: FC<ConfirmationPanelProps> = ({ panelState }) => {
    const dispatch = useAppDispatch();
    const { status, isProcessing } = useAppSelector(state => ({
        status: state.status,
        isProcessing: state.isProcessing,
    }));
    const confirmBtnRef = useRef<HTMLButtonElement>(null);

    const handleClose = useCallback(() => dispatch(actions.closePanel()), [dispatch]);

    const handleConfirm = useCallback(() => {
        if (status === AppStatus.READY && !isProcessing) {
            dispatch(panelState.onConfirmAction);
        } else {
            handleClose();
        }
    }, [dispatch, status, isProcessing, panelState.onConfirmAction, handleClose]);

    useEffect(() => {
        const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="v-panel-container is-active is-modal-like" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
            <div className="v-inline-panel v-confirmation-panel" data-confirmation-title={panelState.title}>
                <h3>{panelState.title}</h3>
                <p>{panelState.message}</p>
                <div className="modal-buttons">
                    <button ref={confirmBtnRef} className="mod-warning" aria-label={`Confirm: ${panelState.title}`} onClick={handleConfirm}>
                        Confirm
                    </button>
                    <button aria-label="Cancel action" onClick={handleClose}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};
