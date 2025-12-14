import { type FC, memo } from 'react';
import { MAX_DESC_LENGTH, type EntryEditorProps } from '@/ui/components/HistoryEntry/types';

export const EntryEditor: FC<EntryEditorProps> = memo(({
    isVisible,
    descValue,
    setDescValue,
    placeholderDesc,
    handleDescTextareaKeyDown,
    descTextareaRef,
}) => {
    if (!isVisible) return null;

    return (
        <div className="v-entry-description-editor">
            <textarea
                ref={descTextareaRef}
                placeholder={placeholderDesc}
                aria-label="Description input"
                value={descValue}
                onChange={(e) => setDescValue(e.target.value)}
                onKeyDown={handleDescTextareaKeyDown}
                onClick={(e) => e.stopPropagation()}
                maxLength={MAX_DESC_LENGTH}
            />
        </div>
    );
});

EntryEditor.displayName = 'EntryEditor';
