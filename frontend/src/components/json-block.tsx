import { cn } from '@/lib/utils';
import { Fragment } from 'react';

type JsonTokenKind = 'punct' | 'key' | 'str' | 'num' | 'bool' | 'null' | 'ws';

type HighlightableToken = Exclude<JsonTokenKind, 'ws'>;

/** Full literal class strings so Tailwind JIT always emits them (dialog-safe vs @layer base). */
const JSON_TOKEN_CLASSES: Record<HighlightableToken, string> = {
  punct: 'text-zinc-500 dark:text-zinc-500',
  key: 'font-medium text-sky-700 dark:text-sky-400',
  str: 'text-emerald-700 dark:text-emerald-400',
  num: 'text-amber-700 dark:text-amber-400',
  bool: 'text-violet-700 dark:text-violet-400',
  null: 'text-zinc-500 dark:text-zinc-400',
};

function tokenizeJson(input: string): { kind: JsonTokenKind; text: string }[] {
  const tokens: { kind: JsonTokenKind; text: string }[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      const start = index;
      while (index < input.length && /\s/.test(input[index]!)) {
        index++;
      }
      tokens.push({ kind: 'ws', text: input.slice(start, index) });
      continue;
    }

    if ('{}[],:'.includes(char)) {
      tokens.push({ kind: 'punct', text: char });
      index++;
      continue;
    }

    if (char === '"') {
      const start = index;
      index++;
      while (index < input.length) {
        const current = input[index]!;
        if (current === '\\') {
          index += 2;
          continue;
        }
        if (current === '"') {
          index++;
          break;
        }
        index++;
      }
      const raw = input.slice(start, index);
      let peek = index;
      while (peek < input.length && /\s/.test(input[peek]!)) {
        peek++;
      }
      const isKey = input[peek] === ':';
      tokens.push({ kind: isKey ? 'key' : 'str', text: raw });
      continue;
    }

    if (/[-0-9]/.test(char)) {
      const start = index;
      if (char === '-') {
        index++;
      }
      while (index < input.length && /[0-9.eE+-]/.test(input[index]!)) {
        index++;
      }
      tokens.push({ kind: 'num', text: input.slice(start, index) });
      continue;
    }

    if (input.startsWith('true', index)) {
      tokens.push({ kind: 'bool', text: 'true' });
      index += 4;
      continue;
    }
    if (input.startsWith('false', index)) {
      tokens.push({ kind: 'bool', text: 'false' });
      index += 5;
      continue;
    }
    if (input.startsWith('null', index)) {
      tokens.push({ kind: 'null', text: 'null' });
      index += 4;
      continue;
    }

    tokens.push({ kind: 'punct', text: char });
    index++;
  }

  return tokens;
}

function JsonHighlighted({ text }: { text: string }) {
  const tokens = tokenizeJson(text);
  return (
    <>
      {tokens.map((token, tokenIndex) =>
        token.kind === 'ws' ? (
          <Fragment key={tokenIndex}>{token.text}</Fragment>
        ) : (
          <span key={tokenIndex} className={JSON_TOKEN_CLASSES[token.kind]}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}

function stringifyJson(value: unknown, pretty: boolean): string {
  try {
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return JSON.stringify(parsed, null, pretty ? 2 : undefined) ?? value;
      } catch {
        return value;
      }
    }
    return JSON.stringify(value, null, pretty ? 2 : undefined) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Compact one-line JSON for tables (plain text, no highlighting). */
export function jsonToTableCellString(value: unknown): string {
  if (value === undefined) {
    return '—';
  }
  return stringifyJson(value, false);
}

export function JsonBlock({
  value,
  emptyLabel = '—',
  pretty = true,
  className,
}: {
  value: unknown;
  emptyLabel?: string;
  pretty?: boolean;
  className?: string;
}) {
  if (value === undefined) {
    return (
      <p className="max-w-full rounded-md border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  const text = stringifyJson(value, pretty);

  return (
    <pre
      className={cn(
        'max-h-[min(360px,40vh)] w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground',
        className,
      )}
    >
      <code className="block whitespace-pre text-left" data-language="json">
        <JsonHighlighted text={text} />
      </code>
    </pre>
  );
}

/** Single-line / table cell: compact JSON with syntax highlighting. */
export function JsonPayloadSnippet({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  const text = stringifyJson(value, false);

  return (
    <code
      className={cn(
        'block max-w-[min(20rem,42vw)] truncate rounded bg-muted/50 px-1 py-px text-left align-top font-mono text-[10px] leading-tight text-foreground',
        className,
      )}
    >
      <JsonHighlighted text={text} />
    </code>
  );
}
