import { moment } from "obsidian";
import { orderBy } from 'lodash-es';
import { VersionHistoryEntry } from "../../../types";
import { AppState, AppStatus } from "../../../state/state";
import { formatFileSize } from "../../utils/dom";

/**
 * Processes the history from the application state by filtering and sorting it.
 * @param state The current AppState of the application.
 * @returns A new array of VersionHistoryEntry, filtered and sorted.
 */
export function getFilteredAndSortedHistory(state: AppState): VersionHistoryEntry[] {
    if (state.status !== AppStatus.READY) {
        return [];
    }

    let history = [...state.history];
    const { searchQuery, isSearchCaseSensitive } = state;

    if (searchQuery.trim() !== '') {
        const query = searchQuery.trim();
        history = history.filter(v => {
            const searchableString = [
                `V${v.versionNumber}`,
                v.name || '',
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

    const iteratee = (v: VersionHistoryEntry): string | number | Date => {
        switch (property) {
            case 'name':
                // Sort empty names to the end by using a high-value character
                return v.name?.toLowerCase() || '\uffff';
            case 'size':
                return v.size;
            case 'timestamp':
                return new Date(v.timestamp);
            case 'versionNumber':
            default:
                return v.versionNumber;
        }
    };

    return orderBy(history, [iteratee], [direction]);
}
