import React, { useRef, useLayoutEffect } from 'react';
import type { VersionHistoryEntry } from '../../../../types';
import type { AppState } from '../../../../state/state';
import type { HistoryEntryRenderer } from '../HistoryEntryRenderer';

interface HistoryEntryComponentProps {
    version: VersionHistoryEntry;
    state: AppState;
    entryRenderer: HistoryEntryRenderer;
}

/**
 * A React component that acts as a bridge to the vanilla TypeScript HistoryEntryRenderer.
 * It creates a container div and delegates all rendering and updates to the renderer instance.
 * This allows for seamless integration of React-based virtualization with the existing rendering logic.
 */
export const HistoryEntryComponent = React.memo(({ version, state, entryRenderer }: HistoryEntryComponentProps) => {
    const elRef = useRef<HTMLDivElement>(null);

    // useLayoutEffect ensures the DOM is manipulated synchronously before the browser paints,
    // which is crucial for virtualization to prevent flickering when items are recycled.
    useLayoutEffect(() => {
        const currentEl = elRef.current;
        if (!currentEl) {
            // This should not happen if the ref is attached correctly to the div.
            return;
        }
        
        // The `update` method handles both initial render and subsequent updates.
        // We pass `!currentEl.hasChildNodes()` as the `isInitialRender` flag to tell
        // the renderer whether it needs to build the full DOM structure or just update parts of it.
        entryRenderer.update(currentEl, version, state, !currentEl.hasChildNodes());
    }, [version, state, entryRenderer]);

    // This div is merely a container for the vanilla renderer to populate.
    // Its height and position are managed by react-virtuoso.
    return <div ref={elRef} />;
});

// Set a display name for easier debugging in React DevTools.
HistoryEntryComponent.displayName = 'HistoryEntryComponent';
