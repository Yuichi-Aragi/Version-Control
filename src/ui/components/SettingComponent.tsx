import { Setting } from 'obsidian';
import { type FC, type ReactNode, useRef, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

interface SettingComponentProps {
    name: string;
    desc: string;
    children?: ReactNode;
}

export const SettingComponent: FC<SettingComponentProps> = ({ name, desc, children }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        // Always clear the container before creating a new Setting instance.
        // This handles re-renders due to prop changes correctly.
        container.empty();
        const setting = new Setting(container)
            .setName(name)
            .setDesc(desc);

        let root: Root | null = null;
        if (children) {
            const controlEl = setting.controlEl;
            root = createRoot(controlEl);
            root.render(children);
        }
        
        // Return a cleanup function to be executed when the component unmounts
        // or before the effect runs again. This is crucial for preventing memory leaks
        // and ensuring stable integration with Obsidian's imperative DOM components.
        return () => {
            root?.unmount();
        };
    }, [name, desc, children]);

    return <div ref={containerRef} />;
};
