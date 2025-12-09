import { memo, useCallback } from 'react';
import { isEqual } from 'lodash-es';
import { useAppDispatch, useAppSelector } from '../../../hooks/useRedux';
import { thunks } from '../../../../state/thunks';
import type { HistorySettings } from '../../../../types';
import { SettingComponent } from '../../SettingComponent';

interface TextStatSettingConfig {
    enableKey: keyof HistorySettings;
    includeSyntaxKey: keyof HistorySettings;
    enableName: string;
    enableDesc: string;
    includeSyntaxName: string;
    includeSyntaxDesc: string;
}

const createTextStatSetting = (config: TextStatSettingConfig) =>
    memo(({ disabled }: { disabled: boolean }) => {
        const dispatch = useAppDispatch();
        const { isEnabled, includeSyntax } = useAppSelector(state => ({
            isEnabled: !!state.effectiveSettings[config.enableKey],
            includeSyntax: !!state.effectiveSettings[config.includeSyntaxKey],
        }), isEqual);

        const handleEnableToggle = useCallback((val: boolean) => {
            dispatch(thunks.updateSettings({ [config.enableKey]: val } as Partial<HistorySettings>));
        }, [dispatch, config.enableKey]);

        const handleSyntaxToggle = useCallback((val: boolean) => {
            dispatch(thunks.updateSettings({ [config.includeSyntaxKey]: val } as Partial<HistorySettings>));
        }, [dispatch, config.includeSyntaxKey]);

        return (
            <>
                <SettingComponent name={config.enableName} desc={config.enableDesc}>
                    <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={e => handleEnableToggle(e.target.checked)}
                        disabled={disabled}
                        aria-label={`Toggle ${config.enableName.toLowerCase()}`}
                    />
                </SettingComponent>
                {isEnabled && (
                    <div className="v-setting-item-sub-setting">
                        <SettingComponent name={config.includeSyntaxName} desc={config.includeSyntaxDesc}>
                            <input
                                type="checkbox"
                                checked={includeSyntax}
                                onChange={e => handleSyntaxToggle(e.target.checked)}
                                disabled={disabled}
                                aria-label={`Toggle ${config.includeSyntaxName.toLowerCase()}`}
                            />
                        </SettingComponent>
                    </div>
                )}
            </>
        );
    });

export const WordCountSettings = createTextStatSetting({
    enableKey: 'enableWordCount',
    includeSyntaxKey: 'includeMdSyntaxInWordCount',
    enableName: 'Enable word count',
    enableDesc: 'Display the word count for each version.',
    includeSyntaxName: 'Include Markdown syntax',
    includeSyntaxDesc: 'If enabled, the word count will include Markdown characters (e.g., "**", "#").',
});
WordCountSettings.displayName = 'WordCountSettings';

export const CharacterCountSettings = createTextStatSetting({
    enableKey: 'enableCharacterCount',
    includeSyntaxKey: 'includeMdSyntaxInCharacterCount',
    enableName: 'Enable character count',
    enableDesc: 'Display the character count for each version.',
    includeSyntaxName: 'Include Markdown syntax',
    includeSyntaxDesc: 'If enabled, the character count will include Markdown characters.',
});
CharacterCountSettings.displayName = 'CharacterCountSettings';

export const LineCountSettings = createTextStatSetting({
    enableKey: 'enableLineCount',
    includeSyntaxKey: 'includeMdSyntaxInLineCount',
    enableName: 'Enable line count',
    enableDesc: 'Display the line count for each version.',
    includeSyntaxName: 'Include empty lines',
    includeSyntaxDesc: 'If enabled, the line count will be based on the raw text. If disabled, it will count lines in a Markdown-stripped version, which may be fewer.',
});
LineCountSettings.displayName = 'LineCountSettings';
