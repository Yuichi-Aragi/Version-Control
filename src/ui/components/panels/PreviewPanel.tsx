// src/ui/components/panels/PreviewPanel.tsx
import { MarkdownRenderer, moment, Component } from 'obsidian';
import { type FC, useCallback, useState, useRef, useLayoutEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { actions } from '../../../state/appSlice';
import type { PreviewPanel as PreviewPanelState } from '../../../state/state';
import { Icon } from '../Icon';
import { VirtualizedPlaintext } from '../shared/VirtualizedPlaintext';
import { useApp } from '../../AppContext';
import clsx from 'clsx';

interface PreviewPanelProps {
    panelState: PreviewPanelState;
}

export const PreviewPanel: FC<PreviewPanelProps> = ({ panelState }) => {
    const app = useApp();
    const dispatch = useAppDispatch();
    const { settings, notePath } = useAppSelector(state => ({
        settings: state.settings,
        notePath: state.file?.path ?? '',
    }));
    const [localRenderMarkdown, setLocalRenderMarkdown] = useState(false);
    const markdownRef = useRef<HTMLDivElement>(null);

    const { version, content } = panelState;
    const shouldRenderMarkdown = settings.renderMarkdownInPreview || localRenderMarkdown;

    const handleClose = useCallback(() => dispatch(actions.closePanel()), [dispatch]);
    const toggleRenderMode = useCallback(() => setLocalRenderMarkdown(v => !v), []);

    useLayoutEffect(() => {
        if (shouldRenderMarkdown && markdownRef.current) {
            const container = markdownRef.current;
            container.empty();
            try {
                MarkdownRenderer.render(app, content, container, notePath, new Component());
            } catch (error) {
                console.error("VC: Failed to render Markdown preview in panel.", error);
                container.setText(content);
            }
        }
    }, [shouldRenderMarkdown, content, notePath, app]);
    
    const versionLabel = version.name ? `V${version.versionNumber}: ${version.name}` : `Version ${version.versionNumber}`;

    return (
        <div className="v-panel-container is-active">
            <div className="v-inline-panel v-preview-panel">
                <div className="v-preview-panel-content">
                    <div className="v-panel-header">
                        <h3 title={`Timestamp: ${(moment as any)(version.timestamp).format("LLLL")} | Size: ${version.size} bytes`}>
                            {versionLabel}
                        </h3>
                        <div className="v-panel-header-actions">
                            {!settings.renderMarkdownInPreview && (
                                <button className="v-action-btn v-preview-toggle-btn" aria-label="Toggle markdown rendering" onClick={toggleRenderMode}>
                                    <Icon name={localRenderMarkdown ? "code" : "book-open"} />
                                </button>
                            )}
                            <button className="clickable-icon v-panel-close" aria-label="Close preview" onClick={handleClose}>
                                <Icon name="x" />
                            </button>
                        </div>
                    </div>
                    <div className={clsx("v-version-content-preview", { 'is-plaintext': !shouldRenderMarkdown })}>
                        {shouldRenderMarkdown ? (
                            <div ref={markdownRef} />
                        ) : (
                            <VirtualizedPlaintext content={content} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
