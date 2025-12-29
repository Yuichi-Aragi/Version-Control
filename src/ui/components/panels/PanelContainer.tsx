import type { FC } from 'react';
import { useAppSelector } from '@/ui/hooks';
import { PreviewPanel } from './PreviewPanel';
import { DiffPanel } from './DiffPanel';
import { ConfirmationPanel } from './ConfirmationPanel';
import { ActionPanel } from './ActionPanel';
import { ChangelogPanel } from './ChangelogPanel';
import { TimelinePanel } from './TimelinePanel';
import { DashboardPanel } from './DashboardPanel';
import type { PanelState } from '@/state';

const renderPanelComponent = (p: NonNullable<PanelState>): React.ReactNode => {
    switch (p.type) {
        case 'preview':
            return <PreviewPanel panelState={p} />;
        case 'diff':
            // If renderMode is 'window', do not render it in the panel container
            if (p.renderMode === 'window') return null;
            return <DiffPanel panelState={p} />;
        case 'confirmation':
            return <ConfirmationPanel panelState={p} />;
        case 'action':
            return <ActionPanel panelState={p} />;
        case 'changelog':
            return <ChangelogPanel panelState={p} />;
        case 'timeline':
            return <TimelinePanel panelState={p} />;
        case 'dashboard':
            return <DashboardPanel />;
        default:
            return null;
    }
};

export const PanelContainer: FC = () => {
    const panel = useAppSelector((state) => state.app.panel);
    
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
