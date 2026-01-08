import { Component } from 'obsidian';
import { useEffect, useRef } from 'react';

/**
 * React hook that creates and manages an Obsidian Component lifecycle.
 * 
 * The component is loaded when the React component mounts and unloaded when it unmounts.
 * This is essential for interfacing with Obsidian APIs that require a Component instance
 * for lifecycle management, such as `MarkdownRenderer.render` or `registerDomEvent`.
 * 
 * @returns The managed Obsidian Component instance.
 */
export const useObsidianComponent = (): Component => {
    const componentRef = useRef<Component | null>(null);

    // Initialize the component strictly once
    if (!componentRef.current) {
        componentRef.current = new Component();
    }

    useEffect(() => {
        const component = componentRef.current!;
        
        // Load the component when the React component mounts
        component.load();

        // Unload the component when the React component unmounts
        // This cleans up any registered events, intervals, or child components
        return () => {
            component.unload();
        };
    }, []);

    return componentRef.current!;
};
