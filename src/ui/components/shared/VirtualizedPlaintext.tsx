import { useMemo, type FC } from 'react';
import { Virtuoso } from 'react-virtuoso';

interface VirtualizedPlaintextProps {
    content: string;
}

const PlaintextLine: FC<{ line: string }> = ({ line }) => (
    <div className="v-plaintext-line">{line || '\u00A0'}</div>
);
PlaintextLine.displayName = 'PlaintextLine';

export const VirtualizedPlaintext: FC<VirtualizedPlaintextProps> = ({ content }) => {
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
