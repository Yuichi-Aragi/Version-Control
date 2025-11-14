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
    // Refs to hold the persistent Setting instance and React root
    const settingRef = useRef<Setting | null>(null);
    const reactRootRef = useRef<Root | null>(null);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        // Initialize Setting instance on first render
        if (!settingRef.current) {
            settingRef.current = new Setting(container);
        }

        // Update properties imperatively. This avoids re-creating the entire DOM structure.
        settingRef.current.setName(name).setDesc(desc);

        // Manage the React root for children in the control element
        if (children) {
            if (!reactRootRef.current) {
                // Create root if it doesn't exist
                reactRootRef.current = createRoot(settingRef.current.controlEl);
            }
            // Render or update the children. React's diffing will preserve focus on the input.
            reactRootRef.current.render(children);
        } else if (reactRootRef.current) {
            // If children are removed, unmount and clean up
            reactRootRef.current.unmount();
            reactRootRef.current = null;
            settingRef.current.controlEl.empty();
        }
    }, [name, desc, children]);

    // Effect for final cleanup when the component is unmounted from the DOM
    useLayoutEffect(() => {
        return () => {
            reactRootRef.current?.unmount();
        };
    }, []); // Empty dependency array ensures this runs only once on mount/unmount

    return <div ref={containerRef} />;
};
