import { useMemo, type FC, Fragment } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { Change } from 'diff';
import type { DiffType } from '../../../types';
import clsx from 'clsx';

interface DiffLineData {
    key: string;
    type: 'add' | 'remove' | 'context';
    oldLineNum?: number;
    newLineNum?: number;
    content: string;
}

const processLineChanges = (changes: Change[]): DiffLineData[] => {
    const lines: DiffLineData[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;
    let keyCounter = 0;

    for (const part of changes) {
        const partLines = part.value.split('\n');
        if (partLines.length > 0 && partLines[partLines.length - 1] === '') {
            partLines.pop();
        }

        for (const line of partLines) {
            const key = `${keyCounter++}`;
            if (part.added) {
                lines.push({ key, type: 'add', newLineNum: newLineNum++, content: line });
            } else if (part.removed) {
                lines.push({ key, type: 'remove', oldLineNum: oldLineNum++, content: line });
            } else {
                lines.push({ key, type: 'context', oldLineNum: oldLineNum++, newLineNum: newLineNum++, content: line });
            }
        }
    }
    return lines;
};

const DiffLine: FC<{ data: DiffLineData }> = ({ data }) => (
    <div className={`diff-line diff-${data.type}`}>
        <div className="diff-line-gutter">
            <span className="diff-line-num old">{data.oldLineNum ?? ''}</span>
            <span className="diff-line-num new">{data.newLineNum ?? ''}</span>
        </div>
        <span className="diff-line-prefix">
            {data.type === 'add' ? '+' : data.type === 'remove' ? '-' : '\u00A0'}
        </span>
        <span className="diff-line-content">
            {data.content || '\u00A0'}
        </span>
    </div>
);
DiffLine.displayName = 'DiffLine';

const LineDiffViewer: FC<{ changes: Change[] }> = ({ changes }) => {
    const lines = useMemo(() => processLineChanges(changes), [changes]);
    return (
        <Virtuoso
            className="v-virtuoso-container"
            data={lines}
            itemContent={(_index, data) => <DiffLine data={data} />}
        />
    );
};

const UnifiedDiffViewer: FC<{ changes: Change[] }> = ({ changes }) => (
    <pre className="v-unified-diff-view">
        <code>
            {changes.map((part, index) => (
                <span
                    key={index}
                    className={clsx({
                        'diff-add': part.added,
                        'diff-remove': part.removed,
                    })}
                >
                    {part.value}
                </span>
            ))}
        </code>
    </pre>
);

export const VirtualizedDiff: FC<{ changes: Change[]; diffType: DiffType }> = ({ changes, diffType }) => {
    switch (diffType) {
        case 'lines':
            return <LineDiffViewer changes={changes} />;
        case 'words':
        case 'chars':
        case 'json':
            return <UnifiedDiffViewer changes={changes} />;
        default:
            return <LineDiffViewer changes={changes} />;
    }
};
VirtualizedDiff.displayName = 'VirtualizedDiff';
