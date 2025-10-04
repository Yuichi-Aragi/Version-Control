import { useState, useEffect, useCallback, useRef } from 'react';

// Type definitions for better type safety
type Timestamp = number;
type RelativeTimeString = string;
type UpdateInterval = number;

// Constants for better maintainability
const INTERVALS = {
    FIRST_MINUTE: 5 * 1000,
    FIRST_HOUR: 60 * 1000,
    FIRST_DAY: 3600 * 1000,
} as const;

const TIME_THRESHOLDS = {
    MINUTE: 60,
    HOUR: 3600,
    DAY: 86400,
} as const;

// Browser equivalent of moment.js fromNow function
const formatRelativeTime = (timestamp: Timestamp): RelativeTimeString => {
    try {
        const now = new Date();
        const date = new Date(timestamp);
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        
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
        throw new Error(`Failed to format timestamp ${timestamp}: ${error instanceof Error ? error.message : String(error)}`);
    }
};

/**
 * Validates if a value is a valid timestamp
 * @param value - The value to validate
 * @returns True if the value is a valid timestamp
 */
const isValidTimestamp = (value: unknown): value is Timestamp => {
    return typeof value === 'number' && 
           !isNaN(value) && 
           isFinite(value) && 
           value > 0 && 
           value <= Date.now() + 86400000; // Allow timestamps up to 24 hours in the future
};

/**
 * Determines the update interval for the relative time string based on how old the timestamp is.
 * More frequent updates are scheduled for more recent timestamps.
 * @param timestamp - The timestamp in milliseconds.
 * @returns The interval in milliseconds, or -1 if no further updates are needed.
 * @throws {Error} If the timestamp is invalid
 */
const getUpdateInterval = (timestamp: Timestamp): UpdateInterval => {
    if (!isValidTimestamp(timestamp)) {
        throw new Error(`Invalid timestamp: ${timestamp}`);
    }

    const now = Date.now();
    const secondsAgo = (now - timestamp) / 1000;
    
    // Handle future timestamps
    if (secondsAgo < 0) {
        return INTERVALS.FIRST_MINUTE;
    }
    
    if (secondsAgo < TIME_THRESHOLDS.MINUTE) return INTERVALS.FIRST_MINUTE;
    if (secondsAgo < TIME_THRESHOLDS.HOUR) return INTERVALS.FIRST_HOUR;
    if (secondsAgo < TIME_THRESHOLDS.DAY) return INTERVALS.FIRST_DAY;
    return -1; // No updates needed for timestamps older than a day
};

/**
 * A React hook that provides a self-updating relative time string (e.g., "a minute ago").
 * It uses a dynamic interval to efficiently update the timestamp, reducing re-renders.
 * @param timestamp - The timestamp to format, as a number (milliseconds since epoch).
 * @returns A formatted relative time string.
 * @throws {Error} If the timestamp is invalid or formatting fails
 */
export const useRelativeTime = (timestamp: unknown): RelativeTimeString => {
    // Validate input
    if (!isValidTimestamp(timestamp)) {
        throw new Error(`Invalid timestamp provided to useRelativeTime: ${timestamp}`);
    }

    const [relativeTime, setRelativeTime] = useState<RelativeTimeString>(() => {
        try {
            return formatRelativeTime(timestamp);
        } catch (error) {
            console.error('Error initializing relative time:', error);
            return 'Invalid time';
        }
    });

    // Use refs to track the latest values without causing re-renders
    const timestampRef = useRef<Timestamp>(timestamp);
    const intervalRef = useRef<number | null>(null);

    // Update the ref when timestamp changes
    useEffect(() => {
        timestampRef.current = timestamp;
    }, [timestamp]);

    // Memoize the update function to prevent unnecessary re-renders
    const updateRelativeTime = useCallback(() => {
        try {
            const newRelativeTime = formatRelativeTime(timestampRef.current);
            setRelativeTime(prevTime => {
                // Only update if the value actually changed
                return prevTime !== newRelativeTime ? newRelativeTime : prevTime;
            });
        } catch (error) {
            console.error('Error updating relative time:', error);
            // Don't update the state on error to maintain the last valid value
        }
    }, []);

    useEffect(() => {
        // Clear any existing interval
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        try {
            const updateInterval = getUpdateInterval(timestampRef.current);
            
            if (updateInterval === -1) {
                // One final check ensures correctness if the component mounts much later
                updateRelativeTime();
                return;
            }

            intervalRef.current = window.setInterval(updateRelativeTime, updateInterval);
        } catch (error) {
            console.error('Error setting up update interval:', error);
            // Still try to update once even if interval setup fails
            updateRelativeTime();
        }

        // Cleanup function
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [updateRelativeTime]);

    return relativeTime;
};
