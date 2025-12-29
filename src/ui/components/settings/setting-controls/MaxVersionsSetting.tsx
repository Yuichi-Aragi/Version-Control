import { memo, useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { valibotResolver } from '@hookform/resolvers/valibot';
import * as v from 'valibot';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { thunks } from '@/state';
import { SettingComponent } from '@/ui/components';
import { ValidatedInput } from '@/ui/components/settings/controls';

const MaxVersionsSchema = v.object({
    maxVersions: v.pipe(
        // Accept string (from HTML input) or number (from store/defaults)
        v.union([v.string(), v.number()]),
        // Transform string input to number, handling empty strings as NaN to trigger validation failure
        v.transform((input) => (input === '' ? NaN : Number(input))),
        v.number("Must be a number"),
        v.integer("Must be an integer"),
        v.minValue(1, "Minimum is 1 version"),
        v.maxValue(1000, "Maximum is 1000 versions")
    )
});

// The schema output is { maxVersions: number }
type MaxVersionsOutput = v.InferOutput<typeof MaxVersionsSchema>;

// The form state can be string (while typing) or number
type MaxVersionsFormState = { maxVersions: string | number };

export const MaxVersionsSetting: React.FC<{ disabled: boolean }> = memo(({ disabled }) => {
    const dispatch = useAppDispatch();
    const { maxVersions, viewMode } = useAppSelector(state => ({
        maxVersions: state.app.effectiveSettings.maxVersionsPerNote,
        viewMode: state.app.viewMode
    }));

    const { control, handleSubmit, reset } = useForm<MaxVersionsFormState>({
        mode: 'onChange',
        resolver: valibotResolver(MaxVersionsSchema),
        defaultValues: { maxVersions: maxVersions ?? 50 }
    });

    // Sync from store if external change occurs
    useEffect(() => {
        reset({ maxVersions: maxVersions ?? 50 });
    }, [maxVersions, reset]);

    const onSubmit: SubmitHandler<MaxVersionsFormState> = (data) => {
        // The resolver transforms the data to the output type (number) upon success,
        // but RHF types it as the input type (string | number). We cast it here.
        const payload = data as unknown as MaxVersionsOutput;
        dispatch(thunks.updateSettings({ maxVersionsPerNote: payload.maxVersions }));
    };

    const noun = viewMode === 'versions' ? 'versions' : 'edits';
    const name = `Max ${noun} per note`;
    const desc = `Maximum number of ${noun} to keep per note. Oldest ${noun} are deleted first. Minimum 1, maximum 1000. Current: ${maxVersions}`;

    return (
        <SettingComponent 
            name={name} 
            desc={desc}
        >
            <form 
                onSubmit={handleSubmit(onSubmit)} 
                className="v-setting-form"
                style={{ width: '100%' }}
                onBlur={handleSubmit(onSubmit)} // Auto-save on blur if valid
            >
                <ValidatedInput
                    name="maxVersions"
                    control={control}
                    type="number"
                    placeholder="50"
                    disabled={disabled}
                    className="v-settings-input-number"
                />
            </form>
        </SettingComponent>
    );
});
MaxVersionsSetting.displayName = 'MaxVersionsSetting';
