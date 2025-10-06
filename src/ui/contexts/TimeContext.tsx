import { type FC, type ReactNode, createContext, useContext, useEffect, useState, useMemo } from 'react';

const UPDATE_INTERVAL_MS = 1000; // Update every second for fluid time changes

interface TimeContextValue {
    now: number;
}

const TimeContext = createContext<TimeContextValue | null>(null);

export const TimeProvider: FC<{ children: ReactNode }> = ({ children }) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const intervalId = setInterval(() => {
            setNow(Date.now());
        }, UPDATE_INTERVAL_MS);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    const value = useMemo(() => ({ now }), [now]);

    return <TimeContext.Provider value={value}>{children}</TimeContext.Provider>;
};

export const useTime = (): TimeContextValue => {
    const context = useContext(TimeContext);
    if (!context) {
        throw new Error('useTime must be used within a TimeProvider');
    }
    return context;
};
