import clsx from 'clsx';
import { type FC, useCallback, useState, useRef, useLayoutEffect, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { AppStatus } from '../../state/state';
import { Placeholder } from './Placeholder';
import { ErrorDisplay } from './ErrorDisplay';
import { ActionBar } from './ActionBar';
import { HistoryList } from './HistoryList';
import { PanelContainer } from './panels/PanelContainer';
import { SettingsPanel } from './SettingsPanel';
import { KeyUpdateOverlay } from './KeyUpdateOverlay';
import { thunks } from '../../state/thunks';
import { Icon } from './Icon';
import { HistoryListHeader } from './HistoryListHeader';

// A constant for the scroll delta threshold to prevent jitter.
const SCROLL_DELTA_THRESHOLD = 5;

export const VersionControlRoot: FC = () => {
    const dispatch = useAppDispatch();
    const { status, error, panel, isProcessing, isRenaming, keyUpdateActive } = useAppSelector(state => ({
        status: state.status,
        error: state.error,
        panel: state.panel,
        isProcessing: state.isProcessing,
        isRenaming: state.isRenaming,
        keyUpdateActive: state.keyUpdateProgress?.active ?? false,
    }));

    const [isHeaderHidden, setIsHeaderHidden] = useState(false);
    const [historyCounts, setHistoryCounts] = useState({ filtered: 0, total: 0 });

    // Refs for scroll handling and DOM elements
    const lastScrollTop = useRef(0);
    const isTicking = useRef(false);
    const headerRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLElement | Window | null>(null);

    const handleSaveVersionClick = useCallback(() => {
        if (status !== AppStatus.READY || isProcessing || isRenaming) return;
        dispatch(thunks.saveNewVersion());
    }, [dispatch, status, isProcessing, isRenaming]);

    const handleScroll = useCallback(() => {
        const target = scrollerRef.current;
        // Ensure the component is still mounted and we have a scroll target.
        if (!target || !mainRef.current) return;

        // Use requestAnimationFrame to throttle scroll events for performance.
        if (!isTicking.current) {
            window.requestAnimationFrame(() => {
                // Double-check mount status inside the async callback.
                if (!mainRef.current) {
                    isTicking.current = false;
                    return;
                }

                const scrollTop = target instanceof Window ? target.scrollY : target.scrollTop;
                const headerHeight = headerRef.current?.offsetHeight ?? 0;

                // Ignore small scroll movements to prevent jitter (hysteresis).
                if (Math.abs(scrollTop - lastScrollTop.current) <= SCROLL_DELTA_THRESHOLD) {
                    isTicking.current = false;
                    return;
                }

                // Determine scroll direction and update header visibility.
                if (scrollTop > lastScrollTop.current && scrollTop > headerHeight) {
                    // Scrolling down past the header: hide it.
                    setIsHeaderHidden(true);
                } else {
                    // Scrolling up, or near the top of the page: show it.
                    setIsHeaderHidden(false);
                }

                // Update last scroll position. Clamp at 0.
                lastScrollTop.current = scrollTop <= 0 ? 0 : scrollTop;
                isTicking.current = false;
            });
            isTicking.current = true;
        }
    }, []); // No dependencies, as all are refs or stable.

    const handleCountChange = useCallback((filteredCount: number, totalCount: number) => {
        setHistoryCounts({ filtered: filteredCount, total: totalCount });
    }, []);

    useLayoutEffect(() => {
        const headerEl = headerRef.current;
        const mainEl = mainRef.current;
        if (headerEl && mainEl) {
            const setPadding = () => {
                mainEl.style.paddingTop = `${headerEl.offsetHeight}px`;
            };
            const resizeObserver = new ResizeObserver(setPadding);
            resizeObserver.observe(headerEl);
            setPadding();
            return () => resizeObserver.disconnect();
        }
        return () => {};
    }, [status]);

    useEffect(() => {
        const scroller = scrollerRef.current;
        if (scroller) {
            // Use a passive listener for better scroll performance.
            scroller.addEventListener('scroll', handleScroll, { passive: true });
            return () => scroller.removeEventListener('scroll', handleScroll);
        }
        return () => {};
    }, [handleScroll, status]);

    const isOverlayActive = panel !== null && panel.type !== 'settings';
    
    const rootClassName = clsx(
        'version-control-content',
        { 'is-overlay-active': isOverlayActive },
        { 'is-processing': isProcessing || isRenaming }
    );

    const renderContent = () => {
        if (keyUpdateActive) {
            return <KeyUpdateOverlay />;
        }

        switch (status) {
            case AppStatus.INITIALIZING:
                return <Placeholder title="Initializing version control..." iconName="sync" />;
            case AppStatus.PLACEHOLDER:
                return <Placeholder />;
            case AppStatus.ERROR:
                return error ? <ErrorDisplay error={error} /> : <Placeholder title="An unknown error occurred." iconName="alert-circle" />;
            case AppStatus.LOADING:
            case AppStatus.READY:
                return (
                    <>
                        <div ref={headerRef} className={clsx('v-header-wrapper', { 'is-hidden': isHeaderHidden })}>
                            <ActionBar />
                            <HistoryListHeader
                                status={status}
                                filteredCount={historyCounts.filtered}
                                totalCount={historyCounts.total}
                            />
                        </div>
                        <div ref={mainRef} className="v-main">
                            <div className="v-ready-state-container">
                                <HistoryList 
                                    setScrollerRef={(el) => scrollerRef.current = el}
                                    onCountChange={handleCountChange}
                                />
                            </div>
                            <SettingsPanel />
                            <button
                                className="v-fab-save-button"
                                aria-label="Save a new version of the current note"
                                onClick={handleSaveVersionClick}
                                disabled={isProcessing || isRenaming}
                            >
                                <Icon name="plus" />
                            </button>
                        </div>
                    </>
                );
            default:
                return <Placeholder title="An unexpected error occurred in the view." iconName="alert-circle" />;
        }
    };

    return (
        <div className={rootClassName}>
            {renderContent()}
            { !keyUpdateActive && <PanelContainer /> }
        </div>
    );
};
