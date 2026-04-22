import React, { useCallback, useEffect, useState } from 'react';
import { useIpcInvoke, useIpcOn } from '../hooks/useIpc';
import './ModuleConfigForm.css';

// Minimal JSON-Schema shape the form renders. We only interpret the
// keywords each built-in / 3p manifest actually uses today; unsupported
// schemas fall through to a JSON textarea so the user can still edit the
// raw config, we just can't present a structured form.

interface JsonSchemaProperty {
  type?: 'string' | 'boolean' | 'integer' | 'number' | 'object' | 'array' | 'null';
  description?: string;
  enum?: Array<string | number | boolean>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  title?: string;
}

interface ObjectSchema {
  type?: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  additionalProperties?: boolean;
}

export interface ModuleConfigFormProps {
  moduleId: string;
  scopeUnit?: string;
  schema: ObjectSchema;
  /**
   * Fires after a successful `modules:config-set`. Parent components can
   * use this to re-read dependent state (e.g. the Settings panel
   * re-applies the theme).
   */
  onSaved?: (config: Record<string, unknown>) => void;
}

type ConfigGetReply =
  | { moduleId: string; config: Record<string, unknown> }
  | { error: string };

type ConfigSetReply =
  | { kind: 'ok'; config: Record<string, unknown> }
  | { kind: 'error'; code: string; message: string };

type ConfigChangedEvent = {
  kind: 'config-changed';
  moduleId: string;
  scopeUnit?: string;
  config: Record<string, unknown>;
};

export function ModuleConfigForm({
  moduleId,
  scopeUnit,
  schema,
  onSaved,
}: ModuleConfigFormProps): React.JSX.Element {
  const invoke = useIpcInvoke();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'saved' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load current config on mount and whenever moduleId / scope changes.
  useEffect(() => {
    let active = true;
    setStatus({ kind: 'idle' });
    invoke('modules:config-get', { moduleId, scopeUnit }).then(
      (reply: ConfigGetReply | null) => {
        if (!active) return;
        if (!reply) {
          setLoadError('IPC returned no response');
          return;
        }
        if ('error' in reply) {
          setLoadError(reply.error);
          return;
        }
        setLoadError(null);
        setConfig(reply.config);
        setDraft(reply.config);
      },
      (err: unknown) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [invoke, moduleId, scopeUnit]);

  // Live-update from external config-changed events (another window / the
  // TUI, or `modules:config-set` from a subprocess module).
  useIpcOn(
    'modules:event',
    useCallback(
      (event: ConfigChangedEvent | { kind: string; moduleId: string }) => {
        if (event.kind !== 'config-changed') return;
        if (event.moduleId !== moduleId) return;
        const fresh = (event as ConfigChangedEvent).config ?? {};
        setConfig(fresh);
        // Only update the draft when it wasn't dirty — preserve the user's
        // in-flight edits otherwise.
        setDraft((prev) => (shallowEqual(prev, config) ? fresh : prev));
      },
      [moduleId, config],
    ),
  );

  const commit = useCallback(async () => {
    setStatus({ kind: 'saving' });
    const reply = (await invoke('modules:config-set', {
      moduleId,
      scopeUnit,
      patch: draft,
    })) as ConfigSetReply;
    if (reply.kind === 'ok') {
      setConfig(reply.config);
      setStatus({ kind: 'saved' });
      onSaved?.(reply.config);
      // Fade the "saved" pill after a moment.
      setTimeout(() => {
        setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
      }, 1500);
    } else {
      setStatus({ kind: 'error', message: reply.message });
    }
  }, [draft, invoke, moduleId, onSaved, scopeUnit]);

  const revert = useCallback(() => {
    setDraft(config);
    setStatus({ kind: 'idle' });
  }, [config]);

  if (loadError) {
    return (
      <div className="module-config-form module-config-form--error">
        <p>Failed to load config: {loadError}</p>
      </div>
    );
  }

  const dirty = !shallowEqual(draft, config);
  const properties = schema.properties ?? {};
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <div className="module-config-form module-config-form--empty">
        <p>This module doesn't declare any configurable settings.</p>
      </div>
    );
  }

  return (
    <div className="module-config-form">
      <div className="module-config-form__fields">
        {keys.map((key) => (
          <FieldRow
            key={key}
            name={key}
            property={properties[key]}
            value={draft[key]}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, [key]: value }))
            }
          />
        ))}
      </div>

      <div className="module-config-form__actions">
        <button
          type="button"
          className="module-config-form__save"
          onClick={() => void commit()}
          disabled={!dirty || status.kind === 'saving'}
        >
          {status.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="module-config-form__revert"
          onClick={revert}
          disabled={!dirty}
        >
          Revert
        </button>
        {status.kind === 'saved' && (
          <span className="module-config-form__status module-config-form__status--ok">
            ✓ Saved
          </span>
        )}
        {status.kind === 'error' && (
          <span className="module-config-form__status module-config-form__status--error">
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field rendering
// ---------------------------------------------------------------------------

interface FieldRowProps {
  name: string;
  property: JsonSchemaProperty;
  value: unknown;
  onChange: (next: unknown) => void;
}

function FieldRow({
  name,
  property,
  value,
  onChange,
}: FieldRowProps): React.JSX.Element {
  const title = property.title ?? name;
  const description = property.description;

  return (
    <label className="module-config-form__field">
      <div className="module-config-form__field-label">
        <span className="module-config-form__field-name">{title}</span>
        {description && (
          <span className="module-config-form__field-description">
            {description}
          </span>
        )}
      </div>
      <div className="module-config-form__field-input">
        <FieldInput property={property} value={value} onChange={onChange} />
      </div>
    </label>
  );
}

function FieldInput({
  property,
  value,
  onChange,
}: Omit<FieldRowProps, 'name'>): React.JSX.Element {
  if (property.enum && property.enum.length > 0) {
    return (
      <select
        className="module-config-form__select"
        value={value == null ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const match = property.enum!.find((opt) => String(opt) === raw);
          onChange(match ?? raw);
        }}
      >
        {property.enum.map((opt) => (
          <option key={String(opt)} value={String(opt)}>
            {String(opt)}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : false;
    return (
      <input
        type="checkbox"
        className="module-config-form__checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }

  if (property.type === 'integer' || property.type === 'number') {
    const n = typeof value === 'number' ? value : '';
    return (
      <input
        type="number"
        className="module-config-form__number"
        value={n === '' ? '' : n}
        min={property.minimum}
        max={property.maximum}
        step={property.type === 'integer' ? 1 : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(null);
            return;
          }
          const parsed =
            property.type === 'integer' ? parseInt(raw, 10) : Number(raw);
          onChange(Number.isNaN(parsed) ? raw : parsed);
        }}
      />
    );
  }

  // Default: string input. Also covers `type: undefined` and
  // object/array, which we don't support structurally — user types JSON.
  const stringValue = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return (
    <input
      type="text"
      className="module-config-form__text"
      value={stringValue}
      minLength={property.minLength}
      maxLength={property.maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
