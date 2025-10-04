import { moment } from 'obsidian';
import type { FC, ReactNode } from 'react';
import { useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Progress from '@radix-ui/react-progress';
import { useAppDispatch } from '../../hooks/useRedux';
import { actions } from '../../../state/appSlice';
import { thunks } from '../../../state/thunks';
import type { DiffPanel as DiffPanelState } from '../../../state/state';
import type { DiffType } from '../../../types';
import { Icon } from '../Icon';
import { VirtualizedDiff } from '../shared/VirtualizedDiff';

interface DiffPanelProps {
    panelState: DiffPanelState;
}

const DIFF_OPTIONS: { type: DiffType; label: string }[] = [
    { type: 'lines', label: 'Line Diff' },
    { type: 'words', label: 'Word Diff' },
    { type: 'chars', label: 'Character Diff' },
    { type: 'json', label: 'JSON Diff' },
];

const DiffDropdown: FC<{
    currentType: DiffType;
    onSelect: (type: DiffType) => void;
    children: ReactNode;
}> = ({ currentType, onSelect, children }) => (
    <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
            <DropdownMenu.Content className="v-diff-dropdown-content" sideOffset={5} collisionPadding={10}>
                {DIFF_OPTIONS.map(({ type, label }) => (
                    <DropdownMenu.Item key={type} className="v-diff-dropdown-item" onSelect={() => onSelect(type)}>
                        {label}
                        {currentType === type && <Icon name="check" />}
                    </DropdownMenu.Item>
                ))}
            </DropdownMenu.Content>
        </DropdownMenu.Portal>
    </DropdownMenu.Root>
);

export const DiffPanel: FC<DiffPanelProps> = ({ panelState }) => {
    const dispatch = useAppDispatch();
    const { version1, version2, diffChanges, diffType, isReDiffing } = panelState;

    const handleClose = useCallback(() => {
        dispatch(actions.closePanel());
    }, [dispatch]);

    const handleDiffTypeChange = useCallback((newType: DiffType) => {
        if (newType !== diffType) {
            dispatch(thunks.recomputeDiff(newType));
        }
    }, [dispatch, diffType]);

    const v1Label = version1.name ? `"${version1.name}" (V${version1.versionNumber})` : `Version ${version1.versionNumber}`;
    const v2Label = version2.id === 'current'
        ? 'Current note state'
        : 'versionNumber' in version2
            ? (version2.name ? `"${version2.name}" (V${version2.versionNumber})` : `Version ${version2.versionNumber}`)
            : version2.name;

    return (
        <div className="v-panel-container is-active">
            <div className="v-inline-panel v-diff-panel">
                <div className="v-panel-header" onClick={(e) => e.stopPropagation()}>
                    <h3>Comparing versions</h3>
                    <div className="v-panel-header-actions">
                        <DiffDropdown currentType={diffType} onSelect={handleDiffTypeChange}>
                            <button className="clickable-icon v-diff-dropdown-trigger" aria-label="Change diff type" title="Change diff type">
                                <Icon name="git-commit-horizontal" />
                            </button>
                        </DiffDropdown>
                        <button className="clickable-icon v-panel-close" aria-label="Close diff" title="Close diff" onClick={handleClose}>
                            <Icon name="x" />
                        </button>
                    </div>
                </div>
                <div className="v-diff-panel-content">
                    {diffChanges === null ? (
                        <div className="is-loading">
                            <div className="loading-spinner" />
                            <p>Loading diff...</p>
                        </div>
                    ) : (
                        <>
                            <div className="v-diff-meta-container">
                                <div className="v-meta-label">Base (red, -): {v1Label} - {(moment as any)(version1.timestamp).format('LLL')}</div>
                                <div className="v-meta-label">Compared (green, +): {v2Label} - {'versionNumber' in version2 ? (moment as any)(version2.timestamp).format('LLL') : 'Now'}</div>
                            </div>
                            <div className="v-diff-content-wrapper">
                                {isReDiffing && (
                                    <div className="v-diff-progress-overlay">
                                        <p>Calculating {diffType} diff...</p>
                                        <Progress.Root className="v-diff-progress-bar" value={null}>
                                            <Progress.Indicator className="v-diff-progress-indicator" />
                                        </Progress.Root>
                                    </div>
                                )}
                                <VirtualizedDiff changes={diffChanges} diffType={diffType} />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
