import clsx from 'clsx';
import { type FC, memo } from 'react';
import { Icon } from '../Icon';

export interface SettingsActionProps { 
    text: string; 
    icon: string; 
    onClick: () => void; 
    isWarning?: boolean;
    disabled?: boolean;
}

export const SettingsAction: FC<SettingsActionProps> = memo(({ text, icon, onClick, isWarning, disabled = false }) => (
    <button 
        className={clsx('v-settings-action-button', { 'mod-warning': isWarning })} 
        onClick={onClick}
        disabled={disabled}
        aria-label={text} >
        
        <Icon name={icon} />
        <span>{text}</span>
    </button>
));
SettingsAction.displayName = 'SettingsAction';
