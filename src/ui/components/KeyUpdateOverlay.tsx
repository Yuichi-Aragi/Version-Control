import type { FC } from 'react';
import { useAppSelector } from '../hooks/useRedux';
import { Icon } from './Icon';

export const KeyUpdateOverlay: FC = () => {
    const progressState = useAppSelector(state => state.keyUpdateProgress);

    if (!progressState?.active) {
        return null;
    }

    const { progress, total, message } = progressState;
    const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;

    return (
        <div className="v-key-update-overlay">
            <div className="v-key-update-content">
                <div className="v-placeholder-icon">
                    <Icon name="sync" />
                </div>
                <h3>Updating Frontmatter Keys</h3>
                <p>Please wait, this may take a few moments...</p>
                <div className="v-key-update-progress-bar">
                    <div className="v-key-update-progress-bar-inner" style={{ width: `${percentage}%` }}></div>
                </div>
                <div className="v-key-update-progress-text">
                    <span>{percentage}%</span>
                    <span>{progress} / {total} files</span>
                </div>
                <p className="v-key-update-message v-meta-label">{message}</p>
            </div>
        </div>
    );
};
