import type { FC } from 'react';
import { useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { AppStatus } from '../../../state/state';
import type { ConfirmationPanel as ConfirmationPanelState } from '../../../state/state';
import { usePanelClose } from '../../hooks/usePanelClose';
import { useBackdropClick } from '../../hooks/useBackdropClick';
import { useDelayedFocus } from '../../hooks/useDelayedFocus';
import { useCallback } from 'react';

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

    const handleClose = usePanelClose();
    const handleBackdropClick = useBackdropClick(handleClose);

    const handleConfirm = useCallback(() => {
        if (status === AppStatus.READY && !isProcessing) {
            dispatch(panelState.onConfirmAction);
        } else {
            handleClose();
        }
    }, [dispatch, status, isProcessing, panelState.onConfirmAction, handleClose]);

    useDelayedFocus(confirmBtnRef);

    return (
        <div className="v-panel-container is-active is-modal-like" onClick={handleBackdropClick}>
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
