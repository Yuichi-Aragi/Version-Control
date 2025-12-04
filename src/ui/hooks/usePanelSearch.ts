import { useState, useCallback, useRef, useMemo, type ChangeEvent, type KeyboardEvent } from 'react';
import { debounce } from 'obsidian';
import { useDelayedFocus } from './useDelayedFocus';

interface UsePanelSearchProps {
    onSearch?: (query: string) => void;
    totalMatches?: number;
}

export const usePanelSearch = ({ onSearch, totalMatches = 0 }: UsePanelSearchProps = {}) => {
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [localSearchQuery, setLocalSearchQuery] = useState('');
    const [isCaseSensitive, setIsCaseSensitive] = useState(false);
    const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
    
    const searchInputRef = useRef<HTMLInputElement>(null);

    const debouncedSetSearchQuery = useMemo(() => debounce((value: string) => {
        setSearchQuery(value);
        onSearch?.(value);
        // Reset active match when query changes
        setActiveMatchIndex(-1);
    }, 300, true), [onSearch]);

    const handleSearchInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLocalSearchQuery(value);
        debouncedSetSearchQuery(value);
    }, [debouncedSetSearchQuery]);

    const handleToggleSearch = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setIsSearchActive(v => {
            if (v) {
                // Closing search
                setLocalSearchQuery('');
                setSearchQuery('');
                setActiveMatchIndex(-1);
            }
            return !v;
        });
    }, []);

    const handleClearSearch = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setLocalSearchQuery('');
        setSearchQuery('');
        setActiveMatchIndex(-1);
        searchInputRef.current?.focus();
    }, []);

    const goToMatch = useCallback((direction: 'next' | 'prev') => {
        if (totalMatches === 0) return;
        
        setActiveMatchIndex(current => {
            if (direction === 'next') {
                return (current + 1) % totalMatches;
            } else {
                return (current - 1 + totalMatches) % totalMatches;
            }
        });
    }, [totalMatches]);

    const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            handleToggleSearch();
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            goToMatch(e.shiftKey ? 'prev' : 'next');
        }
    }, [handleToggleSearch, goToMatch]);

    const toggleCaseSensitivity = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setIsCaseSensitive(v => !v);
    }, []);

    // Auto-focus input when search becomes active
    useDelayedFocus(searchInputRef, 100, isSearchActive);

    return {
        isSearchActive,
        searchQuery,
        localSearchQuery,
        isCaseSensitive,
        activeMatchIndex,
        searchInputRef,
        handleSearchInputChange,
        handleToggleSearch,
        handleClearSearch,
        handleSearchKeyDown,
        goToMatch,
        toggleCaseSensitivity,
        setActiveMatchIndex
    };
};
