import { moment } from "obsidian";
import { VersionHistoryEntry } from "../../../types";
import { ReadyState } from "../../../state/state";
import { formatFileSize } from "../../utils/dom";

/**
 * Processes the history from the application state by filtering and sorting it.
 * @param state The current ReadyState of the application.
 * @returns A new array of VersionHistoryEntry, filtered and sorted.
 */
export function getFilteredAndSortedHistory(state: ReadyState): VersionHistoryEntry[] {
    let history = [...state.history];
    const { searchQuery, isSearchCaseSensitive } = state;

    if (searchQuery.trim().toLowerCase().startsWith('tag:')) {
        const tagsToSearch = searchQuery.replace(/tag:/i, '').trim().split(/\s+/).filter(t => t);
        if (tagsToSearch.length > 0) {
            history = history.filter(v => {
                if (!v.tags || v.tags.length === 0) return false;
                const versionTags = new Set(v.tags.map(t => isSearchCaseSensitive ? t : t.toLowerCase()));
                return tagsToSearch.every(searchTag => versionTags.has(isSearchCaseSensitive ? searchTag : searchTag.toLowerCase()));
            });
        }
    } else if (searchQuery.trim() !== '') {
        const query = searchQuery.trim();
        history = history.filter(v => {
            const searchableString = [
                `V${v.versionNumber}`,
                v.name || '',
                ...(v.tags || []).map(t => `#${t}`),
                moment(v.timestamp).fromNow(true),
                moment(v.timestamp).format("LLLL"),
                formatFileSize(v.size)
            ].join(' ');

            if (isSearchCaseSensitive) {
                return searchableString.includes(query);
            }
            return searchableString.toLowerCase().includes(query.toLowerCase());
        });
    }

    const { property, direction } = state.sortOrder;
    history.sort((a, b) => {
        let comparison = 0;
        switch (property) {
            case 'name':
                const nameA = a.name?.toLowerCase() || '\uffff'; // Sort empty names to the end
                const nameB = b.name?.toLowerCase() || '\uffff';
                if (nameA < nameB) comparison = -1;
                if (nameA > nameB) comparison = 1;
                break;
            case 'size':
                comparison = a.size - b.size;
                break;
            case 'timestamp':
                comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
                break;
            case 'versionNumber':
            default:
                comparison = a.versionNumber - b.versionNumber;
                break;
        }
        // For string-based sorts, direction is applied directly. For others, it's inverted for 'desc'.
        if (property === 'timestamp' || property === 'versionNumber' || property === 'size') {
             return direction === 'asc' ? comparison : comparison * -1;
        }
        return direction === 'desc' ? comparison * -1 : comparison;
    });

    return history;
}
