import { debounce } from 'obsidian';
import clsx from 'clsx';
import { type FC, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch } from '../../hooks/useRedux';
import { actions } from '../../../state/appSlice';
import type { ActionPanel as ActionPanelState } from '../../../state/state';
import { Icon } from '../Icon';

interface ActionPanelProps {
    panelState: ActionPanelState<any>;
}

export const ActionPanel: FC<ActionPanelProps> = ({ panelState }) => {
    const dispatch = useAppDispatch();
    const [filterQuery, setFilterQuery] = useState('');
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const filterInputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const filteredItems = useMemo(() => {
        if (!filterQuery) return panelState.items;
        const lowerCaseQuery = filterQuery.toLowerCase();
        return panelState.items.filter(item =>
            item.text.toLowerCase().includes(lowerCaseQuery) ||
            (item.subtext && item.subtext.toLowerCase().includes(lowerCaseQuery))
        );
    }, [panelState.items, filterQuery]);

    const handleClose = useCallback(() => dispatch(actions.closePanel()), [dispatch]);
    const chooseItem = useCallback((data: any) => dispatch(panelState.onChooseAction(data)), [dispatch, panelState.onChooseAction]);

    const debouncedSetFilter = useMemo(() => debounce(setFilterQuery, 150, true), []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (filterInputRef.current) {
                filterInputRef.current.focus();
            } else if (listRef.current?.children[0]) {
                (listRef.current.children[0] as HTMLElement).focus();
                setFocusedIndex(0);
            }
        }, 50);
        return () => clearTimeout(timer);
    }, []);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        const listEl = listRef.current;
        if (!listEl) return;

        const items = Array.from(listEl.children) as HTMLElement[];
        if (items.length === 0) return;

        let nextIndex = focusedIndex;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            nextIndex = focusedIndex < 0 ? 0 : (focusedIndex + 1) % items.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const firstItem = items[0];
            if (filterInputRef.current && firstItem && document.activeElement === firstItem) {
                filterInputRef.current.focus();
                return;
            }
            nextIndex = focusedIndex <= 0 ? items.length - 1 : focusedIndex - 1;
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleClose();
            return;
        } else if (e.key === 'Enter' || e.key === ' ') {
            const activeItem = filteredItems[focusedIndex];
            if (activeItem) {
                e.preventDefault();
                chooseItem(activeItem.data);
            }
        }

        if (nextIndex !== focusedIndex) {
            const itemToFocus = items[nextIndex];
            if (itemToFocus) {
                itemToFocus.focus();
            }
        }
    }, [focusedIndex, filteredItems, chooseItem, handleClose]);

    return (
        <div className="v-panel-container is-active is-modal-like" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
            <div className="v-inline-panel v-action-panel" onKeyDown={handleKeyDown}>
                <div className="v-panel-header">
                    <h3>{panelState.title}</h3>
                    <button className="clickable-icon v-panel-close" aria-label="Close" title="Close" onClick={handleClose}>
                        <Icon name="x" />
                    </button>
                </div>
                {panelState.showFilter && (
                    <div className="v-action-panel-filter">
                        <input ref={filterInputRef} type="text" placeholder="Filter options..." onChange={e => debouncedSetFilter(e.target.value)} />
                    </div>
                )}
                <div ref={listRef} className="v-action-panel-list">
                    {filteredItems.length === 0 ? (
                        <div className="v-action-panel-empty">No matching options.</div>
                    ) : (
                        filteredItems.map((item, index) => {
                            const iconToShow = item.isSelected ? 'check' : item.icon;
                            return (
                                <div
                                    key={item.id}
                                    className={clsx('v-action-panel-item', { 'is-selected': item.isSelected })}
                                    tabIndex={0}
                                    onClick={() => chooseItem(item.data)}
                                    onFocus={() => setFocusedIndex(index)}
                                >
                                    {iconToShow && (
                                        <span className="v-action-item-icon">
                                            <Icon name={iconToShow} />
                                        </span>
                                    )}
                                    <div className="v-action-item-text-wrapper">
                                        <div className="v-action-item-text">{item.text}</div>
                                        {item.subtext && <div className="v-action-item-subtext">{item.subtext}</div>}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
};