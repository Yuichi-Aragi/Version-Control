import type { Change } from "diff";

/**
 * Renders diff changes into a container element with a unified, two-column line number format.
 * This function is shared between the Diff Panel and the dedicated Diff View tab.
 * @param container The HTMLElement to render the diff lines into.
 * @param changes The array of Change objects from the diff library.
 */
export function renderDiffLines(container: HTMLElement, changes: Change[]) {
    container.empty();
    let oldLineNum = 1;
    let newLineNum = 1;

    for (const part of changes) {
        // The diff library often includes a trailing newline in the value, which creates an extra empty line.
        // We split by newline and filter out the final empty string if it exists.
        const lines = part.value.split('\n');
        if (lines[lines.length - 1] === '') {
            lines.pop();
        }

        for (const line of lines) {
            const lineEl = container.createDiv({ cls: 'diff-line' });
            
            const gutterEl = lineEl.createDiv({ cls: 'diff-line-gutter' });
            const oldNumEl = gutterEl.createSpan({ cls: 'diff-line-num old' });
            const newNumEl = gutterEl.createSpan({ cls: 'diff-line-num new' });
            
            const prefixEl = lineEl.createSpan({ cls: 'diff-line-prefix' });
            const contentEl = lineEl.createSpan({ cls: 'diff-line-content' });
            
            // Use a non-breaking space for empty lines to ensure they have height.
            contentEl.setText(line || '\u00A0');

            if (part.added) {
                lineEl.addClass('diff-add');
                prefixEl.setText('+');
                newNumEl.setText(String(newLineNum++));
            } else if (part.removed) {
                lineEl.addClass('diff-remove');
                prefixEl.setText('-');
                oldNumEl.setText(String(oldLineNum++));
            } else {
                lineEl.addClass('diff-context');
                prefixEl.setText('\u00A0'); // Add a space for alignment
                oldNumEl.setText(String(oldLineNum++));
                newNumEl.setText(String(newLineNum++));
            }
        }
    }
}
