import { setIcon } from 'obsidian';
import { useRef, useLayoutEffect } from 'react';
import type { FC, HTMLAttributes } from 'react';

interface IconProps extends HTMLAttributes<HTMLSpanElement> {
    name: string;
}

export const Icon: FC<IconProps> = ({ name, ...props }) => {
    const iconRef = useRef<HTMLSpanElement>(null);

    useLayoutEffect(() => {
        if (iconRef.current) {
            // Clear previous icon content before setting a new one
            iconRef.current.empty();
            setIcon(iconRef.current, name);
        }
    }, [name]);

    return <span ref={iconRef} {...props} />;
};
