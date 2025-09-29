import type { FC } from 'react';
import { useAppSelector } from '../../hooks/useRedux';
import { PreviewPanel } from './PreviewPanel';
import { DiffPanel } from './DiffPanel';
import { ConfirmationPanel } from './ConfirmationPanel';
import { ActionPanel } from './ActionPanel';
import { ChangelogPanel } from './ChangelogPanel';

export const PanelContainer: FC = () => {
    const panel = useAppSelector((state) => state.panel);
    
    if (!panel || panel.type === 'settings') {
        return null;
    }

    switch (panel.type) {
        case 'preview':
            return <PreviewPanel panelState={panel} />;
        case 'diff':
            return <DiffPanel panelState={panel} />;
        case 'confirmation':
            return <ConfirmationPanel panelState={panel} />;
        case 'action':
            return <ActionPanel panelState={panel} />;
        case 'changelog':
            return <ChangelogPanel panelState={panel} />;
        default:
            return null;
    }
};
