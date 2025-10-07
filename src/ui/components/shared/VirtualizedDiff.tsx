import { useMemo, type FC } from 'react';
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

/**
 * Processes an array of `Change` objects from the `diff` library into a
 * line-by-line structure suitable for rendering in a virtualized list.
 * This function handles `Change` objects that may contain multiple lines.
 *
 * @param changes An array of `Change` objects from `diffLines`.
 * @returns An array of `DiffLineData` objects, where each object represents a single display line.
 */
const processLineChanges = (changes: Change[]): DiffLineData[] => {
    const lines: DiffLineData[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;
    let keyCounter = 0;

    for (const part of changes) {
        const type = part.added ? 'add' : part.removed ? 'remove' : 'context';
        // The `value` from `diffLines` can contain multiple lines. We split by newline
        // to process each one individually.
        const partLines = part.value.split('\n');
        const lastIndex = partLines.length - 1;

        partLines.forEach((line, i) => {
            // The `diff` library's behavior with `split('\n')`:
            // - "a\nb\n" -> ["a", "b", ""]
            // - "a\nb"   -> ["a", "b"]
            // The trailing empty string indicates that the original string ended with a newline.
            // We must skip this trailing empty string, as the newline it represents has already
            // been accounted for by the line before it.
            if (i === lastIndex && line === '') {
                return;
            }

            const lineData: DiffLineData = {
                key: `${keyCounter++}`,
                type,
                content: line,
            };

            if (type !== 'add') {
                lineData.oldLineNum = oldLineNum++;
            }
            if (type !== 'remove') {
                lineData.newLineNum = newLineNum++;
            }

            lines.push(lineData);
        });
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
