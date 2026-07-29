import clsx from 'clsx';

export interface SettingsSwitchProps {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SettingsSwitch({
  checked,
  label,
  onCheckedChange,
  disabled = false,
}: SettingsSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
      className={clsx(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-aegis-primary/55 bg-aegis-primary/35'
          : 'border-aegis-border bg-aegis-input',
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'absolute start-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-transform',
          checked
            ? 'translate-x-[21px] bg-aegis-primary rtl:-translate-x-[21px]'
            : 'translate-x-0 bg-aegis-text-dim',
        )}
      />
    </button>
  );
}
