import { cn } from '@/lib/utils';
import { type ReactNode } from 'react';

/** V8 / Node: `    at fn (path/to/file.ts:10:5)` */
const AT_WITH_PARENS =
  /^(\s*at\s+)(async\s+)?([\s\S]+?)\s+\(([^)]+)\)\s*$/;

/**
 * `    at path...:line:col` without wrapping parens (incl. Windows paths — split from the right).
 */
function parseBareAtLine(line: string): {
  indentAt: string;
  pathPart: string;
  lineNumber: string;
  columnNumber: string;
} | null {
  const match = /^(\s*at\s+)([\s\S]+)$/.exec(line);
  if (!match) {
    return null;
  }
  const [, indentAt, rest] = match;
  const tailMatch = /:(\d+):(\d+)$/.exec(rest);
  if (!tailMatch) {
    return null;
  }
  const lineNumber = tailMatch[1];
  const columnNumber = tailMatch[2];
  const pathPart = rest.slice(0, tailMatch.index);
  if (!pathPart.trim()) {
    return null;
  }
  return { indentAt, pathPart, lineNumber, columnNumber };
}

function highlightFileLocation(location: string): ReactNode {
  const trimmed = location.trim();
  const fileLoc =
    /^(.+\.(?:tsx?|jsx?|mjs|cjs|vue|json|map|wasm|cts|mts)):(\d+):(\d+)$/.exec(trimmed);
  if (fileLoc) {
    const [, filePath, lineNumber, columnNumber] = fileLoc;
    return (
      <>
        <span className="text-foreground">{filePath}</span>
        <span className="text-muted-foreground">:</span>
        <span className="tabular-nums text-muted-foreground">{lineNumber}</span>
        <span className="text-muted-foreground">:</span>
        <span className="tabular-nums text-muted-foreground/90">{columnNumber}</span>
      </>
    );
  }

  const loose = /^([\s\S]+):(\d+):(\d+)$/.exec(trimmed);
  if (loose) {
    const [, pathPart, lineNumber, columnNumber] = loose;
    return (
      <>
        <span className="text-foreground">{pathPart}</span>
        <span className="text-muted-foreground">:</span>
        <span className="tabular-nums text-muted-foreground">{lineNumber}</span>
        <span className="text-muted-foreground">:</span>
        <span className="tabular-nums text-muted-foreground/90">{columnNumber}</span>
      </>
    );
  }

  return <span className="text-foreground">{location}</span>;
}

function StackTraceLine({ line, lineIndex }: { line: string; lineIndex: number }) {
  const trimmed = line.trimStart();

  if (lineIndex === 0 && trimmed.length > 0 && !trimmed.startsWith('at ')) {
    return <span className="font-semibold text-destructive">{line}</span>;
  }

  const withParens = AT_WITH_PARENS.exec(line);
  if (withParens) {
    const [, indentAt, asyncKeyword, functionPart, locationInside] = withParens;
    return (
      <>
        <span className="text-muted-foreground">{indentAt}</span>
        {asyncKeyword ? (
          <span className="font-medium text-muted-foreground">{asyncKeyword}</span>
        ) : null}
        <span className="text-foreground/95">{functionPart.trim()}</span>
        <span className="text-muted-foreground"> (</span>
        {highlightFileLocation(locationInside)}
        <span className="text-muted-foreground">)</span>
      </>
    );
  }

  const bareAt = parseBareAtLine(line);
  if (bareAt) {
    const { indentAt, pathPart, lineNumber, columnNumber } = bareAt;
    return (
      <>
        <span className="text-muted-foreground">{indentAt}</span>
        <span className="text-foreground">{pathPart}</span>
        <span className="text-muted-foreground">:</span>
        <span className="tabular-nums text-muted-foreground">{lineNumber}</span>
        <span className="text-muted-foreground">:</span>
        <span className="tabular-nums text-muted-foreground/90">{columnNumber}</span>
      </>
    );
  }

  if (trimmed.startsWith('at ')) {
    return <span className="text-muted-foreground">{line}</span>;
  }

  return <span className="text-foreground/85">{line}</span>;
}

export function StackTraceBlock({ lines }: { lines: string[] }) {
  return (
    <div
      className={cn(
        'max-h-64 min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded-md border border-border bg-muted/25',
        'shadow-inner',
      )}
    >
      <div className="min-w-0 divide-y divide-border/60 font-mono text-[10px] leading-relaxed">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn('break-all px-3 py-1.5', index % 2 === 1 && 'bg-muted/35')}
          >
            <StackTraceLine line={line} lineIndex={index} />
          </div>
        ))}
      </div>
    </div>
  );
}
