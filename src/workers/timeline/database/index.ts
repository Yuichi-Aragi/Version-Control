/**
 * Database Module
 *
 * Exports database-related functionality including Dexie setup
 * and CRUD operations for timeline events.
 */

export { InternalTimelineDB, getDb } from './timeline-db';
export {
    getTimelineEvents,
    putTimelineEvent,
    findExistingEvent,
    updateEventMetadata,
    deleteEventByVersion,
    clearTimelineForNote,
    clearAllTimeline,
} from './db-operations';