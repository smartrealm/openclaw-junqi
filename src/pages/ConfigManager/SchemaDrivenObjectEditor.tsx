import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Save } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  schemaStringOptions,
  schemaValueKind,
  type OpenClawFieldSchema,
} from '@/services/openclawConfigSchema';

function replaceField(value: Record<string, any>, field: string, nextValue: unknown) {
  const next = { ...value };
  if (nextValue === undefined || nextValue === '') delete next[field];
  else next[field] = nextValue;
  return next;
}

function PrimitiveField({ name, schema, value, disabled, onChange }: {
  name: string;
  schema: OpenClawFieldSchema;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const kind = schemaValueKind(schema);
  const options = schemaStringOptions(schema);
  const className = 'mt-1 w-full rounded-md border border-aegis-border bg-aegis-surface px-2.5 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary disabled:opacity-50';
  return (
    <label className="min-w-0 text-[11px] font-medium text-aegis-text-secondary">
      <span title={schema.description}>{t(`config.schemaFields.${name}`, schema.title ?? name)}</span>
      {kind === 'boolean' ? (
        <select className={className} value={value === undefined ? '' : String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}>
          <option value="">{t('config.notSet', 'Not set')}</option><option value="true">true</option><option value="false">false</option>
        </select>
      ) : options.length > 0 ? (
        <select className={className} value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={(event) => onChange(event.target.value || undefined)}>
          <option value="">{t('config.notSet', 'Not set')}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input
          className={className}
          type={kind === 'number' || kind === 'integer' ? 'number' : 'text'}
          min={schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : schema.minimum}
          max={schema.maximum}
          step={kind === 'integer' ? 1 : 'any'}
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(!event.target.value
            ? undefined
            : kind === 'number' || kind === 'integer'
              ? Number(event.target.value)
              : event.target.value)}
        />
      )}
      {schema.description && <span className="mt-1 block line-clamp-2 text-[10px] font-normal text-aegis-text-muted">{schema.description}</span>}
    </label>
  );
}

export function SchemaDrivenObjectEditor({
  title,
  fields,
  value,
  exclude = [],
  disabled = false,
  initiallyOpen = false,
  onChange,
}: {
  title: string;
  fields: Record<string, OpenClawFieldSchema>;
  value: Record<string, any>;
  exclude?: string[];
  disabled?: boolean;
  initiallyOpen?: boolean;
  onChange: (value: Record<string, any>) => void;
}) {
  const { t } = useTranslation();
  const excluded = useMemo(() => new Set(exclude), [exclude.join('\0')]);
  const editable = useMemo(() => Object.entries(fields).filter(([name]) => !excluded.has(name)), [excluded, fields]);
  const primitives = editable.filter(([, schema]) => ['string', 'number', 'integer', 'boolean'].includes(schemaValueKind(schema)));
  const structured = editable.filter(([, schema]) => !['string', 'number', 'integer', 'boolean'].includes(schemaValueKind(schema)));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(structured.map(([name]) => [name, JSON.stringify(value[name] ?? {}, null, 2)])));
  }, [fields, value]);

  return (
    <details open={initiallyOpen || undefined} className="group border-t border-aegis-border pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-aegis-text-secondary">
        <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
        {title}<span className="text-xs font-normal text-aegis-text-muted">{t('config.schemaFieldCount', { count: editable.length, defaultValue: '{{count}} official fields' })}</span>
      </summary>
      <div className="mt-3 space-y-4 pl-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {primitives.map(([name, schema]) => (
            <PrimitiveField key={name} name={name} schema={schema} value={value[name]} disabled={disabled} onChange={(next) => onChange(replaceField(value, name, next))} />
          ))}
        </div>
        {structured.map(([name, schema]) => (
          <div key={name} className="border-t border-aegis-border pt-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div><div className="text-xs font-medium text-aegis-text-secondary">{t(`config.schemaFields.${name}`, schema.title ?? name)}</div>{schema.description && <div className="mt-0.5 text-xs text-aegis-text-muted">{schema.description}</div>}</div>
              <button type="button" disabled={disabled} onClick={() => {
                try {
                  const parsed = JSON.parse(drafts[name] || '{}');
                  onChange(replaceField(value, name, Object.keys(parsed).length ? parsed : undefined));
                  setErrors((current) => ({ ...current, [name]: '' }));
                } catch (error: any) {
                  setErrors((current) => ({ ...current, [name]: error?.message || String(error) }));
                }
              }} className="inline-flex items-center gap-1 rounded border border-aegis-border px-2 py-1 text-xs text-aegis-text-secondary hover:text-aegis-text disabled:opacity-50"><Save size={11} /> {t('config.apply', 'Apply')}</button>
            </div>
            <textarea value={drafts[name] ?? '{}'} disabled={disabled} spellCheck={false} onChange={(event) => setDrafts((current) => ({ ...current, [name]: event.target.value }))} className={clsx('min-h-28 w-full resize-y rounded-md border bg-aegis-surface p-2.5 font-mono text-xs leading-relaxed text-aegis-text outline-none', errors[name] ? 'border-red-400/60' : 'border-aegis-border focus:border-aegis-primary')} />
            {errors[name] && <p className="mt-1 text-[11px] text-red-400">{errors[name]}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}
