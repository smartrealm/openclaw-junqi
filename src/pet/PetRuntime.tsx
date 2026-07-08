import { usePetStateEmitter } from './usePetStateEmitter';
import { usePomodoro } from './usePomodoro';
import { usePetActions } from './usePetActions';
import { usePetShortcuts } from './usePetShortcuts';

export default function PetRuntime() {
  usePetStateEmitter();
  usePomodoro();
  usePetActions();
  usePetShortcuts();
  return null;
}
