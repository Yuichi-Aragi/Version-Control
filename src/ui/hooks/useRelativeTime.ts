import { useState, useEffect } from 'react';
import { moment } from 'obsidian';

/**
 * Determines the update interval for the relative time string based on how old the timestamp is.
 * More frequent updates are scheduled for more recent timestamps.
 * @param timestamp - The timestamp in milliseconds.
 * @returns The interval in milliseconds, or -1 if no further updates are needed.
 */
const getUpdateInterval = (timestamp: number): number => {
    const secondsAgo = (Date.now() - timestamp) / 1000;
    if (secondsAgo < 60) return 5 * 1000; // Every 5 seconds for the first minute
    if (secondsAgo < 3600) return 60 * 1000; // Every minute for the first hour
    if (secondsAgo < 86400) return 3600 * 1000; // Every hour for the first day
    return -1; // No updates needed for timestamps older than a day
};

/**
 * A React hook that provides a self-updating relative time string (e.g., "a minute ago").
 * It uses a dynamic interval to efficiently update the timestamp, reducing re-renders.
 * @param timestamp - The timestamp to format, as a number (milliseconds since epoch).
 * @returns A formatted relative time string.
 */
export const useRelativeTime = (timestamp: number): string => {
    const [relativeTime, setRelativeTime] = useState(() => (moment as any)(timestamp).fromNow());

    useEffect(() => {
        const updateInterval = getUpdateInterval(timestamp);
        
        if (updateInterval === -1) {
            // If the time is old enough, we might have already rendered the final relative string.
            // One final check ensures correctness if the component mounts much later.
            const newRelativeTime = (moment as any)(timestamp).fromNow();
            if (newRelativeTime !== relativeTime) {
                setRelativeTime(newRelativeTime);
            }
            return;
        }

        const timerId = setInterval(() => {
            setRelativeTime((moment as any)(timestamp).fromNow());
        }, updateInterval);

        return () => clearInterval(timerId);
    }, [timestamp, relativeTime]);

    return relativeTime;
};
