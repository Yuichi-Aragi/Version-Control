import { useEffect } from 'react';

export function useEntryHighlight(
    isNamingThisVersion: boolean,
    nameInputRef: React.RefObject<HTMLInputElement | null>,
    descTextareaRef: React.RefObject<HTMLTextAreaElement | null>,
    isManualVersionEdit: boolean,
    enableVersionNaming: boolean
) {
    useEffect(() => {
        if (isNamingThisVersion) {
            const inputToFocus = (isManualVersionEdit || enableVersionNaming) ? nameInputRef.current : descTextareaRef.current;
            if (inputToFocus) {
                const id = window.setTimeout(() => {
                    try {
                        inputToFocus.focus();
                        if (inputToFocus instanceof HTMLInputElement) {
                            inputToFocus.select();
                        }
                    } catch { /* ignore focus errors */ }
                }, 50);
                return () => window.clearTimeout(id);
            }
        }
        return;
    }, [isNamingThisVersion, enableVersionNaming, isManualVersionEdit, nameInputRef, descTextareaRef]);
}
