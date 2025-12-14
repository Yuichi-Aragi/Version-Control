import { MarkdownRenderer, Component } from 'obsidian';
import { type FC, useRef, useLayoutEffect } from 'react';
import type { ChangelogPanel as ChangelogPanelState } from '@/state';
import { Icon } from '@/ui/components';
import { useApp } from '@/ui/AppContext';
import { usePanelClose } from '@/ui/hooks';

interface ChangelogPanelProps {
    panelState: ChangelogPanelState;
}

export const ChangelogPanel: FC<ChangelogPanelProps> = ({ panelState }) => {
    const app = useApp();
    const markdownRef = useRef<HTMLDivElement>(null);
    const { content } = panelState;

    const handleClose = usePanelClose();

    useLayoutEffect(() => {
        if (content && markdownRef.current) {
            const container = markdownRef.current;
            container.empty();
            try {
                // The source path can be an empty string as we are not resolving local links.
                MarkdownRenderer.render(app, content, container, '', new Component());
            } catch (error) {
                console.error("VC: Failed to render changelog Markdown.", error);
                container.setText("Failed to render changelog. See console for details.");
            }
        }
    }, [content, app]);

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
                        {content === null ? (
                            <div className="is-loading">
                                <div className="loading-spinner" />
                                <p>Loading changelog...</p>
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
