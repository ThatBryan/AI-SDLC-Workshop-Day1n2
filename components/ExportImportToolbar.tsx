'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

type ExportImportToolbarProps = {
  onImported: () => void;
};

export function ExportImportToolbar({ onImported }: ExportImportToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'notice' | 'error';
    text: string;
  } | null>(null);

  function download(format: 'json' | 'csv') {
    const link = document.createElement('a');
    link.href = `/api/todos/export?format=${format}`;
    link.download = '';
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setImporting(true);
    setMessage(
      file.size > 10 * 1024 * 1024
        ? { type: 'notice', text: 'Large backup selected; import may take a while.' }
        : null,
    );
    try {
      const contents = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(contents);
      } catch {
        throw new Error('Invalid JSON format');
      }

      const response = await fetch('/api/todos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: string;
        imported?: number;
      };
      if (!response.ok) {
        throw new Error(result.error ?? 'Failed to import todos');
      }
      if (
        typeof result.imported !== 'number' ||
        !Number.isSafeInteger(result.imported) ||
        result.imported < 0
      ) {
        throw new Error('Import returned an invalid result');
      }

      setMessage({
        type: 'success',
        text: `Successfully imported ${result.imported} todos`,
      });
      onImported();
    } catch (failure) {
      setMessage({
        type: 'error',
        text: failure instanceof Error ? failure.message : 'Failed to import todos',
      });
    } finally {
      setImporting(false);
      input.value = '';
    }
  }

  return (
    <section aria-label="Export and import todos" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => download('json')}>
          Export JSON
        </button>
        <button type="button" className="secondary" onClick={() => download('csv')}>
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={importing}
        >
          {importing ? 'Importing…' : 'Import'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          disabled={importing}
          aria-label="Choose a JSON backup"
          onChange={importFile}
        />
      </div>
      <p className="muted text-sm">
        Import adds new todos and does not merge them with existing items.
      </p>
      {message && (
        <p
          role={message.type === 'error' ? 'alert' : 'status'}
          className={
            message.type === 'success'
              ? 'text-green-700 dark:text-green-300'
              : message.type === 'notice'
                ? 'muted'
                : 'error'
          }
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
