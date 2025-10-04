import { MarkdownRenderer, App, moment, Component } from 'obsidian';
import { type FC, useState, useCallback, useLayoutEffect, useRef } from 'react';
import type { VersionPreviewViewDisplayState } from '../version-preview-view';
import { useAppSelector } from '../hooks/useRedux';
import { Icon } from './Icon';

interface VersionPreviewRootProps {
    app: App;
    displayState: VersionPreviewViewDisplayState | null;
}

export const VersionPreviewRoot: FC<VersionPreviewRootProps> = ({ app, displayState }) => {
    const settings = useAppSelector(state => state.settings);
    const [localRenderMarkdown, setLocalRenderMarkdown] = useState(false);
    const markdownRef = useRef<HTMLDivElement>(null);

    const toggleRenderMode = useCallback(() => setLocalRenderMarkdown(v => !v), []);

    useLayoutEffect(() => {
        if (!displayState || !markdownRef.current) return;
        
        const shouldRenderMarkdown = settings.renderMarkdownInPreview || localRenderMarkdown;
        if (shouldRenderMarkdown && !displayState.content.startsWith("This preview is potentially stale.")) {
            markdownRef.current.empty();
            try {
                MarkdownRenderer.render(app, displayState.content, markdownRef.current, displayState.notePath, new Component());
            } catch (error) {
                console.error("Version Control: Failed to render Markdown preview in dedicated tab.", error);
                markdownRef.current.setText(displayState.content);
            }
        }
    }, [displayState, settings.renderMarkdownInPreview, localRenderMarkdown, app]);

    if (!displayState) {
        return <div className="v-tab-view-content">No version data to display. Open a version preview from the version control panel.</div>;
    }

    const { version, content, notePath, noteName } = displayState;
    const versionDisplayLabel = version.name || `Version ${version.versionNumber}`;
    const shouldRenderMarkdown = settings.renderMarkdownInPreview || localRenderMarkdown;
    const isStale = content.startsWith("This preview is potentially stale.");

    return (
        <div className="v-tab-view-content">
            <div className="v-panel-header">
                <div className="v-panel-title-row">
                    <h3 title={`Timestamp: ${(moment as any)(version.timestamp).format("LLLL")} | Size: ${version.size} bytes`}>
                        {versionDisplayLabel}
                    </h3>
                    {!settings.renderMarkdownInPreview && (
                        <button className="v-action-btn" aria-label="Toggle markdown rendering" onClick={toggleRenderMode}>
                            <Icon name={localRenderMarkdown ? "code" : "book-open"} />
                        </button>
                    )}
                </div>
                <div className="v-meta-label">Preview of a version from note: "{noteName}"</div>
                <div className="v-meta-label">Original path: {notePath}</div>
            </div>
            <div className="v-version-content-preview">
                {isStale || !shouldRenderMarkdown ? (
                    <pre className="is-plaintext">{content}</pre>
                ) : (
                    <div ref={markdownRef} />
                )}
            </div>
        </div>
    );
};
