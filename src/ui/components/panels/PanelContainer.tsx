import type { FC } from 'react';
import { useAppSelector } from '../../hooks/useRedux';
import { PreviewPanel } from './PreviewPanel';
import { DiffPanel } from './DiffPanel';
import { ConfirmationPanel } from './ConfirmationPanel';
import { ActionPanel } from './ActionPanel';
import { ChangelogPanel } from './ChangelogPanel';
import { DescriptionPanel } from './DescriptionPanel';
import type { PanelState } from '../../../state/state';

const renderPanelComponent = (p: NonNullable<PanelState>): React.ReactNode => {
    switch (p.type) {
        case 'preview':
            return <PreviewPanel panelState={p} />;
        case 'diff':
            return <DiffPanel panelState={p} />;
        case 'confirmation':
            return <ConfirmationPanel panelState={p} />;
        case 'action':
            return <ActionPanel panelState={p} />;
        case 'changelog':
            return <ChangelogPanel panelState={p} />;
        case 'description':
            return <DescriptionPanel />;
        default:
            return null;
    }
};

export const PanelContainer: FC = () => {
    const panel = useAppSelector((state) => state.panel);
    
    if (!panel || panel.type === 'settings') {
        return null;
    }

    if (panel.type === 'stacked') {
        return (
            <>
                {renderPanelComponent(panel.base)}
                {renderPanelComponent(panel.overlay)}
            </>
        );
    }

    return renderPanelComponent(panel);
};
