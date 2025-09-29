import type { FC } from 'react';
import { Icon } from './Icon';

interface PlaceholderProps {
    title?: string;
    iconName?: string;
}

export const Placeholder: FC<PlaceholderProps> = ({
    title = "Open a markdown note to see its version history.",
    iconName = "file-text",
}) => {
    return (
        <div className="v-placeholder">
            <div className="v-placeholder-icon">
                <Icon name={iconName} />
            </div>
            <p className="v-placeholder-title">{title}</p>
            {title === "Open a markdown note to see its version history." && (
                <p className="v-placeholder-subtitle v-meta-label">
                    If the note is already open, try focusing its editor pane. Save a version to begin tracking changes.
                </p>
            )}
        </div>
    );
};
