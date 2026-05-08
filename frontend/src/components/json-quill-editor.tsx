import Quill from 'quill';
import type { ComponentRef } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import ReactQuill from 'react-quill';

import {
  highlightPayloadDeltaOps,
  type DeltaOps,
} from '@/lib/quill-json-highlight';
import { cn } from '@/lib/utils';

import 'react-quill/dist/quill.snow.css';

const DeltaConstructor = Quill.import('delta') as new (operations?: DeltaOps) => {
  ops: DeltaOps;
};

function plainTextToDelta(text: string): InstanceType<typeof DeltaConstructor> {
  const normalized = text.endsWith('\n') ? text : `${text}\n`;
  return new DeltaConstructor([{ insert: normalized }]);
}

function deltaToPlainText(delta: { ops?: DeltaOps }): string {
  let output = '';
  for (const operation of delta.ops ?? []) {
    const insert = operation.insert;
    if (typeof insert === 'string') {
      output += insert;
    }
  }
  return output.replace(/\uFEFF/g, '').replace(/\n+$/, '');
}

export function JsonQuillEditor({
  value,
  onChange,
  className,
  minHeightClassName = 'min-h-[220px]',
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  minHeightClassName?: string;
}) {
  const reactQuillReference = useRef<ComponentRef<typeof ReactQuill>>(null);
  const applyingSyntaxReference = useRef(false);
  const lastEmittedReference = useRef(value);

  const applySyntaxHighlightToEditor = useCallback((editor: Quill) => {
    if (applyingSyntaxReference.current) {
      return;
    }
    applyingSyntaxReference.current = true;
    try {
      const selection = editor.getSelection(true);
      const caretIndex = selection?.index ?? 0;
      const selectionLength = selection?.length ?? 0;
      const contents = editor.getContents();
      const nextOps = highlightPayloadDeltaOps(contents.ops ?? []);
      const nextDelta = new DeltaConstructor(nextOps);
      if (deltaToPlainText({ ops: contents.ops }) !== deltaToPlainText({ ops: nextDelta.ops })) {
        return;
      }
      editor.setContents(nextDelta, Quill.sources.SILENT);
      editor.setSelection(caretIndex, selectionLength, Quill.sources.SILENT);
    } finally {
      applyingSyntaxReference.current = false;
    }
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const editor = reactQuillReference.current?.getEditor();
      if (!editor) {
        return;
      }
      const currentSerialized = deltaToPlainText(editor.getContents());
      if (currentSerialized === value) {
        lastEmittedReference.current = value;
        return;
      }
      editor.setContents(plainTextToDelta(value), Quill.sources.SILENT);
      lastEmittedReference.current = value;
      queueMicrotask(() => applySyntaxHighlightToEditor(editor));
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [value, applySyntaxHighlightToEditor]);

  const handleChange = useCallback(
    (_html: string, _delta: unknown, source: string, editor: Quill) => {
      const nextPayload = deltaToPlainText(editor.getContents());
      if (nextPayload !== lastEmittedReference.current) {
        lastEmittedReference.current = nextPayload;
        onChange(nextPayload);
      }

      if (source !== 'user') {
        return;
      }

      window.setTimeout(() => {
        applySyntaxHighlightToEditor(editor);
      }, 160);
    },
    [onChange, applySyntaxHighlightToEditor],
  );

  return (
    <div
      className={cn(
        'json-quill-editor [&_.ql-toolbar]:hidden [&_.ql-container]:rounded-b-md [&_.ql-container]:border-0',
        className,
      )}
    >
      <ReactQuill
        ref={reactQuillReference}
        theme="snow"
        modules={{ toolbar: false }}
        formats={['color']}
        onChange={handleChange}
        className={cn(
          'rounded-md border border-input bg-background',
          '[&_.ql-editor]:font-mono [&_.ql-editor]:text-[12px] [&_.ql-editor]:leading-relaxed',
          minHeightClassName,
        )}
      />
    </div>
  );
}
