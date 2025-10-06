import clsx from 'clsx';
import { type FC, useEffect, useRef, memo, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { thunks } from '../../state/thunks';
import { GlobalSettings } from './settings/GlobalSettings';
import { NoteSpecificSettings } from './settings/NoteSpecificSettings';
import { Icon } from './Icon';
import { actions } from '../../state/appSlice';

const AUTO_CLOSE_DELAY_MS = 30000;

const SettingsPanelComponent: FC = () => {
    const dispatch = useAppDispatch();
    const isActive = useAppSelector(state => state.panel?.type === 'settings');
    const panelRef = useRef<HTMLDivElement | null>(null);
    const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const resetInactivityTimer = useCallback(() => {
        if (inactivityTimerRef.current !== null) {
            clearTimeout(inactivityTimerRef.current);
            inactivityTimerRef.current = null;
        }
        inactivityTimerRef.current = setTimeout(() => {
            dispatch(thunks.closeSettingsPanelWithNotice("Settings panel auto-closed due to inactivity.", 2000));
            inactivityTimerRef.current = null;
        }, AUTO_CLOSE_DELAY_MS);
    }, [dispatch]);

    useEffect(() => {
        if (!isActive) return;
        
        const panelEl = panelRef.current;
        if (!panelEl) return;

        const handleInteraction = () => resetInactivityTimer();
        
        panelEl.addEventListener('click', handleInteraction, { capture: true });
        panelEl.addEventListener('input', handleInteraction, { capture: true });
        panelEl.addEventListener('keydown', handleInteraction, { capture: true });
        
        resetInactivityTimer();

        return () => {
            if (inactivityTimerRef.current !== null) {
                clearTimeout(inactivityTimerRef.current);
                inactivityTimerRef.current = null;
            }
            panelEl.removeEventListener('click', handleInteraction, { capture: true } as EventListenerOptions);
            panelEl.removeEventListener('input', handleInteraction, { capture: true } as EventListenerOptions);
            panelEl.removeEventListener('keydown', handleInteraction, { capture: true } as EventListenerOptions);
        };
    }, [dispatch, isActive, resetInactivityTimer]);

    return (
        <div 
            className={clsx("v-settings-panel", { "is-active": isActive })}
            role="dialog"
            aria-modal={isActive}
        >
            <div className="v-settings-panel-header">
                <h3>Settings</h3>
                <button 
                    className="clickable-icon v-panel-close" 
                    aria-label="Close settings" 
                    onClick={() => dispatch(actions.closePanel())}
                >
                    <Icon name="x" />
                </button>
            </div>
            <div ref={panelRef} className="v-settings-panel-content-wrapper">
                <GlobalSettings />
                <NoteSpecificSettings />
            </div>
        </div>
    );
};

export const SettingsPanel = memo(SettingsPanelComponent);
SettingsPanel.displayName = 'SettingsPanel';