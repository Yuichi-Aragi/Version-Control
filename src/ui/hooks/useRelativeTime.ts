import { useMemo } from 'react';
import { useTime } from '../contexts/TimeContext';

// Type definitions
type Timestamp = number;
type RelativeTimeString = string;

/**
 * A pure function to format a timestamp into a relative time string (e.g., "a minute ago").
 * This is a lightweight, browser-compatible alternative to moment.js's fromNow().
 * @param timestamp - The timestamp to format (in milliseconds).
 * @param now - The current time (in milliseconds) to compare against.
 * @returns A formatted relative time string.
 */
const formatRelativeTime = (timestamp: Timestamp, now: Timestamp): RelativeTimeString => {
    try {
        const diffInSeconds = Math.floor((now - timestamp) / 1000);
        
        // Handle future timestamps
        if (diffInSeconds < 0) {
            return 'in a few seconds';
        }
        
        // Handle seconds
        if (diffInSeconds < 45) {
            return 'a few seconds ago';
        }
        
        // Handle minutes
        if (diffInSeconds < 90) {
            return 'a minute ago';
        }
        
        const minutes = Math.floor(diffInSeconds / 60);
        if (minutes < 45) {
            return `${minutes} minutes ago`;
        }
        
        // Handle hours
        if (minutes < 90) {
            return 'an hour ago';
        }
        
        const hours = Math.floor(minutes / 60);
        if (hours < 24) {
            return `${hours} hours ago`;
        }
        
        // Handle days
        if (hours < 36) {
            return 'a day ago';
        }
        
        const days = Math.floor(hours / 24);
        if (days < 30) {
            return `${days} days ago`;
        }
        
        // Handle months
        if (days < 45) {
            return 'a month ago';
        }
        
        const months = Math.floor(days / 30);
        if (months < 12) {
            return `${months} months ago`;
        }
        
        // Handle years
        if (months < 18) {
            return 'a year ago';
        }
        
        const years = Math.floor(months / 12);
        return `${years} years ago`;
    } catch (error) {
        console.error(`Failed to format timestamp ${timestamp}: ${error instanceof Error ? error.message : String(error)}`);
        return 'Invalid time';
    }
};

/**
 * Validates if a value is a valid, positive, finite number.
 * @param value - The value to validate.
 * @returns True if the value is a valid timestamp.
 */
const isValidTimestamp = (value: unknown): value is Timestamp => {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
};

/**
 * A React hook that provides a self-updating relative time string (e.g., "a minute ago").
 * It subscribes to a global time context for efficient, batched updates, ensuring that
 * all visible timestamps on the screen update simultaneously and smoothly.
 * @param timestamp - The timestamp to format, as a number (milliseconds since epoch).
 * @returns A memoized, formatted relative time string.
 */
export const useRelativeTime = (timestamp: unknown): RelativeTimeString => {
    const { now } = useTime();

    return useMemo(() => {
        if (!isValidTimestamp(timestamp)) {
            // Return a stable string for invalid inputs to prevent errors downstream.
            return 'Invalid time';
        }
        return formatRelativeTime(timestamp, now);
    }, [timestamp, now]);
};
