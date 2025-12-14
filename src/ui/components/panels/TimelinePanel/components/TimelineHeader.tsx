import type { FC } from 'react';
import clsx from 'clsx';
import { Icon } from '@/ui/components';
import type { TimelineHeaderProps } from '@/ui/components/panels/TimelinePanel/types';
import { TimelineFilters } from '@/ui/components/panels/TimelinePanel/components/TimelineFilters';

export const TimelineHeader: FC<TimelineHeaderProps> = ({
    viewMode,
    settings,
    searchState,
    matchController,
    onNavigateMatch
}) => {
    const timelineTitle = viewMode === 'versions' ? 'Version Timeline' : 'Edit Timeline';

    return (
        <div className={clsx('v-panel-header', { 'is-searching': searchState.isSearchActive })}>
            <div className="v-panel-header-content">
                <h3>{timelineTitle}</h3>
                <div className="v-panel-header-actions">
                    <button className="clickable-icon" onClick={searchState.handleToggleSearch}>
                        <Icon name="search" />
                    </button>
                    <TimelineFilters settings={settings} />
                </div>
            </div>

            <div className="v-panel-search-bar-container" onClick={e => e.stopPropagation()}>
                <div className="v-search-input-wrapper">
                    <div className="v-search-icon" role="button" onClick={searchState.handleToggleSearch}>
                        <Icon name="x-circle" />
                    </div>
                    <input
                        ref={searchState.searchInputRef}
                        type="search"
                        placeholder="Search timeline..."
                        value={searchState.localSearchQuery}
                        onChange={searchState.handleSearchInputChange}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                onNavigateMatch(e.shiftKey ? 'prev' : 'next');
                            }
                            if (e.key === 'Escape') searchState.handleToggleSearch();
                        }}
                    />
                    <div className="v-search-input-buttons">
                        {searchState.searchQuery && matchController.totalMatches > 0 && (
                            <span className="v-search-match-count">
                                {matchController.activeIndex + 1} / {matchController.totalMatches}
                            </span>
                        )}
                        <button
                            className="clickable-icon"
                            disabled={matchController.totalMatches === 0}
                            onClick={() => onNavigateMatch('prev')}
                        >
                            <Icon name="chevron-up" />
                        </button>
                        <button
                            className="clickable-icon"
                            disabled={matchController.totalMatches === 0}
                            onClick={() => onNavigateMatch('next')}
                        >
                            <Icon name="chevron-down" />
                        </button>
                        <button
                            className={clsx('clickable-icon', { 'is-active': searchState.isCaseSensitive })}
                            onClick={searchState.toggleCaseSensitivity}
                        >
                            <Icon name="case-sensitive" />
                        </button>
                        <button
                            className={clsx('clickable-icon', { 'is-hidden': !searchState.localSearchQuery })}
                            onClick={searchState.handleClearSearch}
                        >
                            <Icon name="x" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
