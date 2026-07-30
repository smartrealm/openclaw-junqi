import clsx from 'clsx';
import { ProviderIcon } from './ProviderIcon';
import { normalizeCustomProviderIcon } from './providerAppearance';

export interface ProviderIconInputProps {
  providerId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

export function ProviderIconInput({
  providerId,
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  className,
}: ProviderIconInputProps) {
  return (
    <div className={clsx(
      'flex items-center gap-2 rounded-lg border border-aegis-border bg-aegis-surface px-2 py-1.5',
      'focus-within:border-aegis-primary',
      disabled && 'opacity-50',
      className,
    )}>
      <ProviderIcon providerId={providerId} size={22} customIcon={value} />
      <input
        value={value}
        onChange={(event) => onChange(normalizeCustomProviderIcon(event.target.value))}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-6 min-w-0 flex-1 bg-transparent text-sm text-aegis-text outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
