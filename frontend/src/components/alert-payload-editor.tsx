import Quill from 'quill';
import type { ComponentRef } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactQuill from 'react-quill';

import {
  highlightPayloadDeltaOps,
  type DeltaOps,
} from '@/lib/quill-json-highlight';
import { cn } from '@/lib/utils';

import 'react-quill/dist/quill.snow.css';

/** Slash menu entries: label vs path used as `ctx` field reference. */
export const ALERT_CONTEXT_FIELDS: Array<{ label: string; path: string }> = [
  { label: 'queueName', path: 'queueName' },
  { label: 'trigger', path: 'trigger' },
  { label: 'job.id', path: 'job.id' },
  { label: 'job.name', path: 'job.name' },
  { label: 'job.failedReason', path: 'job.failedReason' },
  { label: 'job.attemptsMade', path: 'job.attemptsMade' },
  { label: 'job.timestamp', path: 'job.timestamp' },
  { label: 'job.processedOn', path: 'job.processedOn' },
  { label: 'job.finishedOn', path: 'job.finishedOn' },
  { label: 'job.data', path: 'job.data' },
  { label: 'error.message', path: 'error.message' },
  { label: 'error.stack', path: 'error.stack' },
];

const KNOWN_CTX_PATHS = new Set(ALERT_CONTEXT_FIELDS.map((fieldItem) => fieldItem.path));

/** Maps `ctx.job?.id` style expressions back to `job.id` for placeholder detection. */
export function jsExpressionToPath(expression: string): string | null {
  const trimmed = expression.trim();
  const match = trimmed.match(/^ctx\.([^?]+(?:\?\.\w+)*)$/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].replace(/\?\./g, '.');
}

const EmbedBlotBase = Quill.import('blots/embed');

class AlertCtxBlot extends EmbedBlotBase {
  static blotName = 'alertCtx';
  static tagName = 'span';
  static className = 'ql-alert-ctx';

  static create(pathUnknown: unknown): HTMLElement {
    const path = typeof pathUnknown === 'string' ? pathUnknown : '';
    const node = super.create() as HTMLElement;
    node.setAttribute('contenteditable', 'false');
    node.setAttribute('spellcheck', 'false');
    node.setAttribute('data-path', path);
    node.textContent = path;
    return node;
  }

  static value(node: HTMLElement): string {
    return node.getAttribute('data-path') ?? '';
  }
}

let alertCtxBlotRegistered = false;

function registerAlertCtxBlot(): void {
  if (alertCtxBlotRegistered) {
    return;
  }
  Quill.register(AlertCtxBlot as unknown as Parameters<typeof Quill.register>[0]);
  alertCtxBlotRegistered = true;
}

registerAlertCtxBlot();

const DeltaConstructor = Quill.import('delta') as new (operations?: DeltaOps) => {
  ops: DeltaOps;
};

export function pathToJsExpression(path: string): string {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) {
    return 'ctx';
  }
  let expression = `ctx.${segments[0]}`;
  for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex++) {
    expression += `?.${segments[segmentIndex]}`;
  }
  return expression;
}

function deltaToPayloadString(delta: { ops?: DeltaOps }): string {
  let output = '';
  for (const operation of delta.ops ?? []) {
    const insert = operation.insert;
    if (typeof insert === 'string') {
      output += insert;
    } else if (
      insert !== null &&
      typeof insert === 'object' &&
      !Array.isArray(insert) &&
      'alertCtx' in insert
    ) {
      const path = String((insert as { alertCtx: unknown }).alertCtx ?? '');
      output += pathToJsExpression(path);
    }
  }
  return output.replace(/\uFEFF/g, '').replace(/\n+$/, '');
}

/** Turns `ctx.\w+(?:\?\.\w+)*` spans for known paths into `alertCtx` embed blots. */
function payloadStringToDelta(text: string): InstanceType<typeof DeltaConstructor> {
  const body = text.replace(/\n+$/, '');
  const expressionPattern = /ctx\.\w+(?:\?\.\w+)*/g;
  const operations: DeltaOps = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = expressionPattern.exec(body))) {
    if (match.index > lastIndex) {
      operations.push({ insert: body.slice(lastIndex, match.index) });
    }
    const path = jsExpressionToPath(match[0]);
    if (path !== null && KNOWN_CTX_PATHS.has(path)) {
      operations.push({ insert: { alertCtx: path } });
    } else {
      operations.push({ insert: match[0] });
    }
    lastIndex = expressionPattern.lastIndex;
  }
  if (lastIndex < body.length) {
    operations.push({ insert: body.slice(lastIndex) });
  }
  if (operations.length === 0) {
    operations.push({ insert: '' });
  }

  const lastOperation = operations[operations.length - 1];
  const lastInsert = lastOperation.insert;
  if (typeof lastInsert === 'string') {
    lastOperation.insert = lastInsert.endsWith('\n') ? lastInsert : `${lastInsert}\n`;
  } else {
    operations.push({ insert: '\n' });
  }

  return new DeltaConstructor(operations);
}

/**
 * Quill `getText()` omits embed ops, so lengths do not match document indices. Slash detection
 * must walk `getContents(i, 1)` or anchors desync from `getBounds` (menu jumps to top-left).
 */
function getSingleDocumentUnit(editor: Quill, index: number): string | 'embed' | null {
  if (index < 0 || index >= editor.getLength()) {
    return null;
  }
  const fragment = editor.getContents(index, 1);
  const insert = fragment.ops[0]?.insert;
  if (typeof insert === 'string') {
    return insert.length > 0 ? insert.charAt(0) : null;
  }
  if (insert !== null && typeof insert === 'object') {
    return 'embed';
  }
  return null;
}

function parseSlashMenuAtCursor(editor: Quill, cursorIndex: number): SlashMenuState | null {
  let filterReversed = '';
  let position = cursorIndex - 1;

  while (position >= 0) {
    const unit = getSingleDocumentUnit(editor, position);
    if (unit === null) {
      return null;
    }
    if (unit === 'embed') {
      return null;
    }

    if (/[\w.]/.test(unit)) {
      filterReversed += unit;
      position--;
      continue;
    }

    if (unit === '/') {
      const anchorIndex = position;
      if (anchorIndex > 0) {
        const previousUnit = getSingleDocumentUnit(editor, anchorIndex - 1);
        if (previousUnit !== null && previousUnit !== 'embed') {
          const previousCharacter = previousUnit;
          // Word chars / dots: middle of identifiers (`foo/bar`). `/`: URLs & `//` comments.
          if (/[\w.]/.test(previousCharacter) || previousCharacter === '/') {
            return null;
          }
        }
      }
      const filterPart = filterReversed.split('').reverse().join('').toLowerCase();
      return { anchorIndex, filter: filterPart };
    }

    return null;
  }

  return null;
}

type SlashMenuState = {
  anchorIndex: number;
  filter: string;
};

export function AlertPayloadEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (nextPayloadBody: string) => void;
}) {
  const reactQuillReference = useRef<ComponentRef<typeof ReactQuill>>(null);
  const lastEmittedReference = useRef(value);
  const applyingSyntaxHighlightReference = useRef(false);
  const syntaxHighlightTimerReference = useRef(0);
  /** Mirrors `slashMenu` for Quill listeners (must not lag one frame behind state). */
  const slashMenuReference = useRef<SlashMenuState | null>(null);

  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);

  const updateSlashMenu = useCallback((nextSlashMenu: SlashMenuState | null) => {
    slashMenuReference.current = nextSlashMenu;
    setSlashMenu(nextSlashMenu);
  }, []);

  const slashDropdownContainerReference = useRef<HTMLDivElement>(null);
  const insertFieldFromSlashMenuReference = useRef<(path: string) => void>(() => {});

  const [slashHighlightedIndex, setSlashHighlightedIndex] = useState(0);

  const filteredSlashItems = useMemo(() => {
    const query = slashMenu?.filter ?? '';
    if (query === '') {
      return ALERT_CONTEXT_FIELDS;
    }
    return ALERT_CONTEXT_FIELDS.filter((fieldItem) =>
      fieldItem.path.toLowerCase().includes(query),
    );
  }, [slashMenu?.filter]);

  const slashKeyboardRefs = useRef({
    filteredItems: filteredSlashItems,
    highlightedIndex: 0,
  });
  slashKeyboardRefs.current.filteredItems = filteredSlashItems;
  slashKeyboardRefs.current.highlightedIndex = slashHighlightedIndex;

  useEffect(() => {
    if (slashMenu === null) {
      return;
    }
    setSlashHighlightedIndex(0);
  }, [slashMenu?.anchorIndex, slashMenu?.filter]);

  useEffect(() => {
    setSlashHighlightedIndex((previousIndex) =>
      Math.min(previousIndex, Math.max(0, filteredSlashItems.length - 1)),
    );
  }, [filteredSlashItems.length]);

  useLayoutEffect(() => {
    if (slashMenuReference.current === null || slashDropdownContainerReference.current === null) {
      return;
    }
    const optionButtons =
      slashDropdownContainerReference.current.querySelectorAll('button[role="option"]');
    const activeButton = optionButtons.item(slashHighlightedIndex);
    activeButton?.scrollIntoView({ block: 'nearest' });
  }, [slashHighlightedIndex, slashMenu?.anchorIndex, slashMenu?.filter]);

  const applySyntaxHighlightToEditor = useCallback((editor: Quill) => {
    if (slashMenuReference.current !== null) {
      return;
    }
    if (applyingSyntaxHighlightReference.current) {
      return;
    }
    applyingSyntaxHighlightReference.current = true;
    try {
      const selection = editor.getSelection(true);
      const caretIndex = selection?.index ?? 0;
      const selectionLength = selection?.length ?? 0;
      const contents = editor.getContents();
      const nextOps = highlightPayloadDeltaOps(contents.ops ?? []);
      const nextDelta = new DeltaConstructor(nextOps);
      if (deltaToPayloadString(contents) !== deltaToPayloadString(nextDelta)) {
        return;
      }
      editor.setContents(nextDelta, Quill.sources.SILENT);
      editor.setSelection(caretIndex, selectionLength, Quill.sources.SILENT);
    } finally {
      applyingSyntaxHighlightReference.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    let pollAttempts = 0;
    const pollIntervalId = window.setInterval(() => {
      pollAttempts++;
      const editor = reactQuillReference.current?.getEditor();
      if (cancelled || pollAttempts > 80) {
        window.clearInterval(pollIntervalId);
        return;
      }
      if (!editor) {
        return;
      }
      window.clearInterval(pollIntervalId);

      queueMicrotask(() => applySyntaxHighlightToEditor(editor));
    }, 50);

    return () => {
      cancelled = true;
      window.clearInterval(pollIntervalId);
      window.clearTimeout(syntaxHighlightTimerReference.current);
    };
  }, [applySyntaxHighlightToEditor]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const editor = reactQuillReference.current?.getEditor();
      if (!editor) {
        return;
      }
      const currentSerialized = deltaToPayloadString(editor.getContents());
      if (currentSerialized === value) {
        lastEmittedReference.current = value;
        return;
      }
      editor.setContents(payloadStringToDelta(value), Quill.sources.SILENT);
      lastEmittedReference.current = value;
      queueMicrotask(() => applySyntaxHighlightToEditor(editor));
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [value, applySyntaxHighlightToEditor]);

  const handleChange = useCallback(
    (_html: string, _delta: unknown, source: string, editor: Quill) => {
      const nextPayload = deltaToPayloadString(editor.getContents());
      if (nextPayload !== lastEmittedReference.current) {
        lastEmittedReference.current = nextPayload;
        onChange(nextPayload);
      }

      if (source !== 'user') {
        return;
      }

      window.clearTimeout(syntaxHighlightTimerReference.current);

      const range = editor.getSelection();
      if (!range) {
        updateSlashMenu(null);
        syntaxHighlightTimerReference.current = window.setTimeout(() => {
          applySyntaxHighlightToEditor(editor);
        }, 200);
        return;
      }

      const parsedSlashMenu = parseSlashMenuAtCursor(editor, range.index);
      if (parsedSlashMenu !== null) {
        updateSlashMenu(parsedSlashMenu);
        return;
      }
      updateSlashMenu(null);
      syntaxHighlightTimerReference.current = window.setTimeout(() => {
        applySyntaxHighlightToEditor(editor);
      }, 200);
    },
    [applySyntaxHighlightToEditor, onChange, updateSlashMenu],
  );

  const insertFieldFromSlashMenu = useCallback(
    (path: string) => {
      const editor = reactQuillReference.current?.getEditor();
      if (!editor || !slashMenu) {
        return;
      }
      const range = editor.getSelection();
      if (!range) {
        updateSlashMenu(null);
        return;
      }

      const deleteLength = range.index - slashMenu.anchorIndex;
      editor.deleteText(slashMenu.anchorIndex, deleteLength, 'user');
      editor.insertEmbed(slashMenu.anchorIndex, 'alertCtx', path, 'user');
      editor.insertText(slashMenu.anchorIndex + 1, ' ', 'user');
      editor.setSelection(slashMenu.anchorIndex + 2, 0, 'silent');

      const nextPayload = deltaToPayloadString(editor.getContents());
      lastEmittedReference.current = nextPayload;
      onChange(nextPayload);
      updateSlashMenu(null);
      queueMicrotask(() => applySyntaxHighlightToEditor(editor));
    },
    [applySyntaxHighlightToEditor, onChange, slashMenu, updateSlashMenu],
  );

  useEffect(() => {
    insertFieldFromSlashMenuReference.current = insertFieldFromSlashMenu;
  }, [insertFieldFromSlashMenu]);

  useEffect(() => {
    if (slashMenu === null) {
      return;
    }

    const onDocumentKeyDownCapture = (event: KeyboardEvent) => {
      if (slashMenuReference.current === null) {
        return;
      }

      const editorInstance = reactQuillReference.current?.getEditor();
      if (!editorInstance) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        updateSlashMenu(null);
        queueMicrotask(() => applySyntaxHighlightToEditor(editorInstance));
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        const itemCount = slashKeyboardRefs.current.filteredItems.length;
        if (itemCount <= 0) {
          return;
        }
        setSlashHighlightedIndex((previousIndex) => Math.min(previousIndex + 1, itemCount - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setSlashHighlightedIndex((previousIndex) => Math.max(previousIndex - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const { filteredItems, highlightedIndex } = slashKeyboardRefs.current;
        const selectedPath = filteredItems[highlightedIndex]?.path;
        if (selectedPath !== undefined) {
          insertFieldFromSlashMenuReference.current(selectedPath);
        }
      }
    };

    document.addEventListener('keydown', onDocumentKeyDownCapture, true);
    return () => document.removeEventListener('keydown', onDocumentKeyDownCapture, true);
  }, [applySyntaxHighlightToEditor, slashMenu, updateSlashMenu]);

  const modules = useMemo(
    () => ({
      toolbar: false,
      clipboard: {
        matchVisual: false,
      },
    }),
    [],
  );

  const slashDropdown =
    slashMenu !== null && filteredSlashItems.length > 0 ? (
      <div
        ref={slashDropdownContainerReference}
        className="payload-slash-menu absolute inset-x-2 bottom-full z-[120] mb-1 max-h-52 min-w-0 overflow-y-auto rounded-md border border-border bg-background py-1 text-foreground shadow-xl ring-1 ring-black/10 dark:bg-card dark:ring-white/15"
        role="listbox"
        aria-label="Insert context field"
      >
        {filteredSlashItems.map((fieldItem, fieldIndex) => (
          <button
            key={fieldItem.path}
            type="button"
            role="option"
            aria-selected={slashHighlightedIndex === fieldIndex}
            className={cn(
              'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs hover:bg-muted',
              slashHighlightedIndex === fieldIndex && 'bg-muted',
            )}
            onMouseEnter={() => setSlashHighlightedIndex(fieldIndex)}
            onMouseDown={(event) => {
              event.preventDefault();
              insertFieldFromSlashMenu(fieldItem.path);
            }}
          >
            <span className="font-medium">{fieldItem.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {pathToJsExpression(fieldItem.path)}
            </span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="alert-payload-quill space-y-2">
      <p className="text-[10px] text-muted-foreground">
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">/</kbd> inserts
        placeholders as chips; the saved payload is still{' '}
        <span className="font-mono text-[10px]">ctx…</span> JavaScript. Colors are approximate JSON/JS
        highlighting.
      </p>

      <div className="relative isolate overflow-visible [&_.ql-container]:overflow-visible">
        {slashDropdown}
        <ReactQuill
          ref={reactQuillReference}
          theme="snow"
          modules={modules}
          formats={['alertCtx', 'color']}
          onChange={handleChange}
          className="rounded-md border border-input bg-background"
        />
      </div>
    </div>
  );
}
