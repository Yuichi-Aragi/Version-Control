import React, { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';

interface VirtualizedPlaintextProps {
    content: string;
}

const PlaintextLine: React.FC<{ line: string }> = ({ line }) => {
    // Use a non-breaking space for empty lines to ensure they have height and are selectable.
    return <div className="v-plaintext-line">{line || '\u00A0'}</div>;
};
PlaintextLine.displayName = 'PlaintextLine';

export const VirtualizedPlaintext: React.FC<VirtualizedPlaintextProps> = ({ content }) => {
    const lines = useMemo(() => content.split('\n'), [content]);

    return (
        <Virtuoso
            className="v-virtuoso-container"
            data={lines}
            itemContent={(_index, line) => <PlaintextLine line={line} />}
        />
    );
};
VirtualizedPlaintext.displayName = 'VirtualizedPlaintext';