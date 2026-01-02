import React, { useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import HeatMap from '@uiw/react-heat-map';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { appSlice } from '@/state/appSlice';
import { useGetVersionHistoryQuery, useGetEditHistoryQuery } from '@/state/apis/history.api';
import { moment } from 'obsidian';

// Define granular color scale for heatmap
const PANEL_COLORS = {
    0: 'var(--background-modifier-border)',
    1: 'rgba(108, 92, 231, 0.15)',
    3: 'rgba(108, 92, 231, 0.25)',
    6: 'rgba(108, 92, 231, 0.35)',
    9: 'rgba(108, 92, 231, 0.45)',
    12: 'rgba(108, 92, 231, 0.55)',
    15: 'rgba(108, 92, 231, 0.65)',
    20: 'rgba(108, 92, 231, 0.75)',
    30: 'rgba(108, 92, 231, 0.85)',
    40: 'rgba(108, 92, 231, 0.95)',
    50: 'var(--interactive-accent)',
};

export const DashboardPanel: React.FC = () => {
    const dispatch = useAppDispatch();
    
    const noteId = useAppSelector(state => state.app.noteId);
    const viewMode = useAppSelector(state => state.app.viewMode);

    // Fetch data using RTK Query hooks
    // We conditionally skip fetching based on viewMode to optimize performance
    const { data: versionHistory = [] } = useGetVersionHistoryQuery(noteId ?? '', {
        skip: !noteId || viewMode !== 'versions'
    });

    const { data: editHistoryData = [] } = useGetEditHistoryQuery(noteId ?? '', {
        skip: !noteId || viewMode !== 'edits'
    });

    const contentRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    const data = useMemo(() => {
        const source = viewMode === 'versions' ? versionHistory : editHistoryData;
        const counts: Record<string, number> = {};

        source.forEach((entry) => {
            // Cast moment to any to bypass TS call signature error common in Obsidian plugins
            const date = (moment as any)(entry.timestamp).format('YYYY/MM/DD');
            counts[date] = (counts[date] || 0) + 1;
        });

        return Object.entries(counts).map(([date, count]) => ({ date, count }));
    }, [versionHistory, editHistoryData, viewMode]);

    // Calculate start date (current month + previous 2 months = 3 months total)
    const startDate = useMemo(() => {
        // Cast moment to any to bypass TS call signature error
        return (moment as any)().subtract(2, 'months').startOf('month').toDate();
    }, []);
    
    const endDate = useMemo(() => (moment as any)().endOf('day').toDate(), []);

    // Close on click outside logic
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // If panel is mounted and click is outside the panelRef (the card)
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                dispatch(appSlice.actions.closePanel());
            }
        };

        // Use mousedown to capture the event early, covering clicks both in the overlay and outside the view
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [dispatch]);

    // Scroll to end of heatmap on mount/update to ensure the latest dates (right side) are visible
    // This fixes the issue where new cells might be cut off if the container is too narrow
    useLayoutEffect(() => {
        if (contentRef.current) {
            contentRef.current.scrollLeft = contentRef.current.scrollWidth;
        }
    }, [data, viewMode]);

    const title = viewMode === 'versions' ? 'Version History Dashboard' : 'Edit History Dashboard';

    // Generate legend items from PANEL_COLORS
    const legendItems = useMemo(() => {
        const keys = Object.keys(PANEL_COLORS).map(Number).sort((a, b) => a - b);
        return keys.map((key, index) => {
            let label = `${key}`;
            // Simple labeling logic: just show the threshold value
            if (index === keys.length - 1) {
                 label = `>= ${key}`;
            }
            return {
                color: PANEL_COLORS[key as keyof typeof PANEL_COLORS],
                label: label,
                key
            };
        });
    }, []);

    // Sticky labels for left column (Mon, Wed, Fri)
    // Rows in HeatMap correspond to days 0-6 (Sun-Sat).
    const dayLabels = [
        { label: '', key: 'sun' },
        { label: 'Mon', key: 'mon' },
        { label: '', key: 'tue' },
        { label: 'Wed', key: 'wed' },
        { label: '', key: 'thu' },
        { label: 'Fri', key: 'fri' },
        { label: '', key: 'sat' },
    ];

    return (
        <div className="v-panel-container is-dashboard-like is-active">
            <div className="v-inline-panel is-dashboard" ref={panelRef}>
                <div className="v-dashboard-card">
                    <div className="v-dashboard-header">
                        <h3>{title}</h3>
                    </div>
                    
                    <div className="v-dashboard-body">
                        {/* Sticky Left Column for Day Labels */}
                        <div className="v-dashboard-labels">
                            {dayLabels.map((day) => (
                                <div key={day.key} className="v-dashboard-label-item">
                                    {day.label}
                                </div>
                            ))}
                        </div>

                        {/* Heatmap Area - No scrolling needed for 3 months */}
                        <div className="v-dashboard-heatmap-wrapper" ref={contentRef} style={{ overflowX: 'auto' }}>
                             <HeatMap
                                value={data}
                                startDate={startDate}
                                endDate={endDate}
                                monthLabels={['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']}
                                rectSize={14}
                                space={4}
                                legendCellSize={0}
                                rectProps={{
                                    rx: 2.5
                                }}
                                panelColors={PANEL_COLORS}
                                // Hide internal week labels since we render them externally
                                weekLabels={['', '', '', '', '', '', '']}
                                style={{ color: 'var(--text-muted)' }}
                            />
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="v-dashboard-legend">
                        {legendItems.map((item) => (
                            <div key={item.key} className="v-legend-item">
                                <div className="v-legend-color" style={{ backgroundColor: item.color }}></div>
                                <span>{item.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
