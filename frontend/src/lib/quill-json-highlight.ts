/**
 * Splits plain text into colored segments (JSON/JS-like) for Quill `color` inline attributes.
 * Not a full parser — sufficient for webhook payloads in the editor.
 */

type DeltaOp = {
  insert?: unknown;
  attributes?: Record<string, unknown>;
};

export type DeltaOps = DeltaOp[];

const COL = {
  string: '#047857',
  number: '#1d4ed8',
  keyword: '#7c3aed',
  punct: '#64748b',
} as const;

type Seg = { text: string; color?: string };

function pushStringSegments(target: Seg[], text: string): void {
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;

    if (/\s/.test(character)) {
      let end = index + 1;
      while (end < text.length && /\s/.test(text[end]!)) {
        end++;
      }
      target.push({ text: text.slice(index, end) });
      index = end;
      continue;
    }

    if (character === '"' || character === "'") {
      const quote = character;
      let end = index + 1;
      while (end < text.length) {
        if (text[end] === '\\') {
          end += 2;
          continue;
        }
        if (text[end] === quote) {
          end++;
          break;
        }
        end++;
      }
      target.push({ text: text.slice(index, end), color: COL.string });
      index = end;
      continue;
    }

    if ('{}[],:'.includes(character)) {
      target.push({ text: character, color: COL.punct });
      index++;
      continue;
    }

    if (character === '-' || /\d/.test(character)) {
      let end = index + 1;
      while (end < text.length && /[0-9.eE+-]/.test(text[end]!)) {
        end++;
      }
      target.push({ text: text.slice(index, end), color: COL.number });
      index = end;
      continue;
    }

    const keywordMatcher = text.slice(index).match(/^(null|true|false)\b/);
    if (keywordMatcher) {
      target.push({
        text: keywordMatcher[0],
        color: COL.keyword,
      });
      index += keywordMatcher[0].length;
      continue;
    }

    target.push({ text: character });
    index++;
  }
}

function segmentsToOps(segments: Seg[]): DeltaOps {
  const operations: DeltaOps = [];
  for (const segment of segments) {
    if (segment.text === '') {
      continue;
    }
    operations.push({
      insert: segment.text,
      ...(segment.color ? { attributes: { color: segment.color } } : {}),
    });
  }
  return operations;
}

function mergeAdjacentOps(ops: DeltaOps): DeltaOps {
  const merged: DeltaOps = [];
  for (const operation of ops) {
    const last = merged[merged.length - 1];
    const insert = operation.insert;
    const lastInsert = last?.insert;
    if (
      last &&
      typeof lastInsert === 'string' &&
      typeof insert === 'string' &&
      JSON.stringify(last.attributes ?? {}) === JSON.stringify(operation.attributes ?? {})
    ) {
      last.insert = lastInsert + insert;
    } else {
      merged.push({ ...operation });
    }
  }
  return merged;
}

/** Strips only `color`; keeps other attributes (if any). */
function stripColor(attributes: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!attributes) {
    return undefined;
  }
  const { color: _omit, ...rest } = attributes;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function highlightPayloadDeltaOps(ops: DeltaOps): DeltaOps {
  const output: DeltaOps = [];
  for (const operation of ops) {
    const insert = operation.insert;
    if (typeof insert === 'string') {
      const segments: Seg[] = [];
      pushStringSegments(segments, insert);
      const highlighted = segmentsToOps(segments);
      const baseAttributes = stripColor(operation.attributes);
      for (const highlightedOperation of highlighted) {
        output.push({
          ...highlightedOperation,
          attributes: {
            ...(baseAttributes ?? {}),
            ...(highlightedOperation.attributes ?? {}),
          },
        });
      }
      continue;
    }
    output.push({
      insert,
      ...(operation.attributes ? { attributes: { ...operation.attributes } } : {}),
    });
  }
  return mergeAdjacentOps(output);
}
