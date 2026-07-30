import { Switch } from '@/components/shared/Switch';

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
    <Switch
      checked={checked}
      label={label}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    />
  );
}
