import type { FC } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAppDispatch } from '@/ui/hooks';
import { thunks } from '@/state';
import { Icon } from '@/ui/components';
import type { TimelineFiltersProps } from '@/ui/components/panels/TimelinePanel/types';
import type { TimelineSettings } from '@/types';

export const TimelineFilters: FC<TimelineFiltersProps> = ({ settings }) => {
    const dispatch = useAppDispatch();

    const toggle = (key: keyof TimelineSettings) => {
        dispatch(thunks.updateTimelineSettings({ [key]: !settings[key] }));
    };

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
                <button className="clickable-icon" aria-label="Timeline Settings">
                    <Icon name="settings-2" />
                </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content className="v-actionbar-dropdown-content" sideOffset={5} collisionPadding={10}>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('showName'); }}>
                        <span>Show Name</span>
                        {settings.showName && <Icon name="check" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('showVersionNumber'); }}>
                        <span>Show Version Number</span>
                        {settings.showVersionNumber && <Icon name="check" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('showDescription'); }}>
                        <span>Show Description</span>
                        {settings.showDescription && <Icon name="check" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('showPreview'); }}>
                        <span>Show Preview</span>
                        {settings.showPreview && <Icon name="check" />}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="v-actionbar-dropdown-item" onSelect={(e) => { e.preventDefault(); toggle('expandByDefault'); }}>
                        <span>Expand Cards by Default</span>
                        {settings.expandByDefault && <Icon name="check" />}
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
};
