import { memo, useCallback } from 'react';
import { isEqual } from 'es-toolkit';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { thunks } from '@/state';
import type { HistorySettings, ViewMode } from '@/types';
import { SettingComponent } from '@/ui/components';

type TextResolver = string | ((mode: ViewMode) => string);

interface TextStatSettingConfig {
    enableKey: keyof HistorySettings;
    includeSyntaxKey: keyof HistorySettings;
    enableName: TextResolver;
    enableDesc: TextResolver;
    includeSyntaxName: TextResolver;
    includeSyntaxDesc: TextResolver;
}

const resolveText = (text: TextResolver, mode: ViewMode) => 
    typeof text === 'function' ? text(mode) : text;

const createTextStatSetting = (config: TextStatSettingConfig) =>
    memo(({ disabled }: { disabled: boolean }) => {
        const dispatch = useAppDispatch();
        const { isEnabled, includeSyntax, viewMode } = useAppSelector(state => ({
            isEnabled: !!state.app.effectiveSettings[config.enableKey],
            includeSyntax: !!state.app.effectiveSettings[config.includeSyntaxKey],
            viewMode: state.app.viewMode,
        }), isEqual);

        const handleEnableToggle = useCallback((val: boolean) => {
            dispatch(thunks.updateSettings({ [config.enableKey]: val } as Partial<HistorySettings>));
        }, [dispatch, config.enableKey]);

        const handleSyntaxToggle = useCallback((val: boolean) => {
            dispatch(thunks.updateSettings({ [config.includeSyntaxKey]: val } as Partial<HistorySettings>));
        }, [dispatch, config.includeSyntaxKey]);

        const resolvedEnableName = resolveText(config.enableName, viewMode);
        const resolvedEnableDesc = resolveText(config.enableDesc, viewMode);
        const resolvedSyntaxName = resolveText(config.includeSyntaxName, viewMode);
        const resolvedSyntaxDesc = resolveText(config.includeSyntaxDesc, viewMode);

        return (
            <>
                <SettingComponent name={resolvedEnableName} desc={resolvedEnableDesc}>
                    <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={e => handleEnableToggle(e.target.checked)}
                        disabled={disabled}
                        aria-label={`Toggle ${resolvedEnableName.toLowerCase()}`}
                    />
                </SettingComponent>
                {isEnabled && (
                    <div className="v-setting-item-sub-setting">
                        <SettingComponent name={resolvedSyntaxName} desc={resolvedSyntaxDesc}>
                            <input
                                type="checkbox"
                                checked={includeSyntax}
                                onChange={e => handleSyntaxToggle(e.target.checked)}
                                disabled={disabled}
                                aria-label={`Toggle ${resolvedSyntaxName.toLowerCase()}`}
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
    enableDesc: (mode) => `Display the word count for each ${mode === 'versions' ? 'version' : 'edit'}.`,
    includeSyntaxName: 'Include markdown syntax',
    includeSyntaxDesc: 'If enabled, the word count will include markdown characters (e.g., "**", "#").',
});
WordCountSettings.displayName = 'WordCountSettings';

export const CharacterCountSettings = createTextStatSetting({
    enableKey: 'enableCharacterCount',
    includeSyntaxKey: 'includeMdSyntaxInCharacterCount',
    enableName: 'Enable character count',
    enableDesc: (mode) => `Display the character count for each ${mode === 'versions' ? 'version' : 'edit'}.`,
    includeSyntaxName: 'Include markdown syntax',
    includeSyntaxDesc: 'If enabled, the character count will include markdown characters.',
});
CharacterCountSettings.displayName = 'CharacterCountSettings';

export const LineCountSettings = createTextStatSetting({
    enableKey: 'enableLineCount',
    includeSyntaxKey: 'includeMdSyntaxInLineCount',
    enableName: 'Enable line count',
    enableDesc: (mode) => `Display the line count for each ${mode === 'versions' ? 'version' : 'edit'}.`,
    includeSyntaxName: 'Include empty lines',
    includeSyntaxDesc: 'If enabled, the line count will be based on the raw text. If disabled, it will count lines in a markdown-stripped version, which may be fewer.',
});
LineCountSettings.displayName = 'LineCountSettings';