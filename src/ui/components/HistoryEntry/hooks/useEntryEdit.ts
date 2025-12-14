import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import type { VersionHistoryEntry as VersionHistoryEntryType } from '@/types';

export function useEntryEdit(
    isNamingThisVersion: boolean,
    version: VersionHistoryEntryType,
    descTextareaRef: React.RefObject<HTMLTextAreaElement | null>
) {
    const [nameValue, setNameValue] = useState('');
    const [descValue, setDescValue] = useState('');
    const ignoreBlurRef = useRef(false);

    useEffect(() => {
        if (isNamingThisVersion) {
            setNameValue(version.name ?? '');
            setDescValue(version.description ?? '');
            ignoreBlurRef.current = true;
            const timer = setTimeout(() => { ignoreBlurRef.current = false; }, 150);
            return () => clearTimeout(timer);
        }
        return;
    }, [isNamingThisVersion, version.name, version.description]);

    useLayoutEffect(() => {
        const textarea = descTextareaRef.current;
        if (textarea && isNamingThisVersion) {
            textarea.style.height = 'inherit';
            const scrollHeight = textarea.scrollHeight;
            textarea.style.height = `${scrollHeight}px`;
        }
    }, [descValue, isNamingThisVersion, descTextareaRef]);

    return {
        nameValue,
        setNameValue,
        descValue,
        setDescValue,
        ignoreBlurRef,
    };
}
