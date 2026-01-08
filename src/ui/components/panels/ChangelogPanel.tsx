import { MarkdownRenderer } from 'obsidian';
import { type FC, useRef, useLayoutEffect } from 'react';
import type { ChangelogPanel as ChangelogPanelState } from '@/state';
import { Icon } from '@/ui/components';
import { useApp } from '@/ui/AppContext';
import { usePanelClose } from '@/ui/hooks';
import { useObsidianComponent } from '@/ui/hooks';
import { useGetChangelogQuery } from '@/state/apis/changelog.api';

interface ChangelogPanelProps {
    panelState: ChangelogPanelState;
}

export const ChangelogPanel: FC<ChangelogPanelProps> = ({ panelState: _ }) => {
    const app = useApp();
    const markdownRef = useRef<HTMLDivElement>(null);
    const handleClose = usePanelClose();

    // Manage Obsidian Component lifecycle for Markdown rendering
    const component = useObsidianComponent();

    // Use RTK Query hook to fetch data
    const { data: content, isLoading, error } = useGetChangelogQuery();

    useLayoutEffect(() => {
        if (content && markdownRef.current) {
            const container = markdownRef.current;
            container.empty();
            try {
                // Pass the managed component to MarkdownRenderer
                // The source path can be an empty string as we are not resolving local links.
                MarkdownRenderer.render(app, content, container, '', component);
            } catch (error) {
                console.error("VC: Failed to render changelog Markdown.", error);
                container.setText("Failed to render changelog. See console for details.");
            }
        }
    }, [content, app, component]);

    return (
        <div className="v-panel-container is-active">
            <div className="v-inline-panel v-preview-panel">
                <div className="v-preview-panel-content">
                    <div className="v-panel-header">
                        <h3>Plugin Changelog</h3>
                        <div className="v-panel-header-actions">
                            <button className="clickable-icon v-panel-close" aria-label="Close changelog" onClick={handleClose}>
                                <Icon name="x" />
                            </button>
                        </div>
                    </div>
                    <div className="v-version-content-preview">
                        {isLoading ? (
                            <div className="is-loading">
                                <div className="loading-spinner" />
                                <p>Loading changelog...</p>
                            </div>
                        ) : error ? (
                            <div className="v-error-message">
                                <p>Failed to load changelog.</p>
                            </div>
                        ) : (
                            <div ref={markdownRef} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
