import { moment } from 'obsidian';
import type { FC, ReactNode } from 'react';
import { useState, useEffect, useCallback } from 'react';
import type { Change } from 'diff';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Progress from '@radix-ui/react-progress';
import type { DiffViewDisplayState, DiffType } from '../../types';
import { VirtualizedDiff } from './shared/VirtualizedDiff';
import { useAppDispatch } from '../hooks/useRedux';
import { thunks } from '../../state/thunks';
import { Icon } from './Icon';

interface VersionDiffRootProps {
    displayState: DiffViewDisplayState | null;
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

export const VersionDiffRoot: FC<VersionDiffRootProps> = ({ displayState }) => {
    const dispatch = useAppDispatch();
    const [isReDiffing, setIsReDiffing] = useState(false);
    const [diffType, setDiffType] = useState<DiffType>('lines');
    const [diffChanges, setDiffChanges] = useState<Change[] | null>(null);

    useEffect(() => {
        if (displayState) {
            setDiffChanges(displayState.diffChanges);
            setDiffType('lines');
            setIsReDiffing(false);
        }
    }, [displayState]);

    const handleDiffTypeChange = useCallback(async (newType: DiffType) => {
        if (!displayState || newType === diffType) return;

        setIsReDiffing(true);
        try {
            const { noteId } = displayState.version1;
            const newChanges = await dispatch(thunks.computeDiffOnly(
                newType,
                noteId,
                displayState.version1,
                displayState.version2,
                displayState.content1,
                displayState.content2
            ));
            setDiffChanges(newChanges);
            setDiffType(newType);
        } catch (error) {
            console.error("Version Control: Failed to re-compute diff in tab.", error);
            dispatch(thunks.showNotice("Failed to re-compute diff. Check console.", 4000));
        } finally {
            setIsReDiffing(false);
        }
    }, [dispatch, displayState, diffType]);

    if (!displayState || !diffChanges) {
        return (
            <div className="v-tab-view-content">
                <div className="is-loading">
                    <p>No diff data to display. Open a diff from the version control panel.</p>
                </div>
            </div>
        );
    }

    const { version1, version2, noteName } = displayState;
    const v1Label = version1.name ? `"${version1.name}" (V${version1.versionNumber})` : `Version ${version1.versionNumber}`;
    const v2Label = 'versionNumber' in version2
        ? (version2.name ? `"${version2.name}" (V${version2.versionNumber})` : `Version ${version2.versionNumber}`)
        : 'Current note state';

    return (
        <div className="v-tab-view-content">
            <div className="v-panel-header">
                <div className="v-panel-title-row">
                    <h3>Comparing versions of "{noteName}"</h3>
                    <div className="v-panel-header-actions">
                        <DiffDropdown currentType={diffType} onSelect={handleDiffTypeChange}>
                            <button className="clickable-icon v-diff-dropdown-trigger" aria-label="Change diff type" title="Change diff type">
                                <Icon name="git-commit-horizontal" />
                            </button>
                        </DiffDropdown>
                    </div>
                </div>
                <div className="v-diff-meta-container">
                    <div className="v-meta-label">Base (red, -): {v1Label} - {(moment as any)(version1.timestamp).format('LLL')}</div>
                    <div className="v-meta-label">Compared (green, +): {v2Label} - {'versionNumber' in version2 ? (moment as any)(version2.timestamp).format('LLL') : 'Now'}</div>
                </div>
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
        </div>
    );
};
