// CopyButton — idle -> copied -> error state machine
// Based on Hermes shared-ui CopyButton pattern.
import { useState, useCallback, type ReactNode } from "react";
import { Copy, Check, AlertCircle } from "lucide-react";
import { Button, type ButtonProps } from "../button";

type CopyState = "idle" | "copied" | "error";

export interface CopyButtonProps extends Omit<ButtonProps, "onClick" | "children" | "leadingIcon"> {
  /** Text to copy, or an async factory returning text */
  text: string | (() => string | Promise<string>);
  /** How long (ms) to show the copied/error state before resetting. Default 1800. */
  resetMs?: number;
  /** Custom label. Defaults to nothing (icon-only). Pass a string to show label. */
  label?: ReactNode;
  /** Called after the clipboard write succeeds. */
  onCopySuccess?: (value: string) => void;
  /** Called when resolving or writing the clipboard value fails. */
  onCopyError?: (error: unknown) => void;
}

export function CopyButton({
  text,
  resetMs = 1800,
  label,
  size = "sm",
  variant = "ghost",
  tone = "neutral",
  iconOnly,
  onCopySuccess,
  onCopyError,
  ...props
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  const handleCopy = useCallback(async () => {
    if (state !== "idle") return;
    try {
      const value = typeof text === "function" ? await text() : text;
      await navigator.clipboard.writeText(value);
      setState("copied");
      onCopySuccess?.(value);
    } catch (error) {
      setState("error");
      onCopyError?.(error);
    } finally {
      setTimeout(() => setState("idle"), resetMs);
    }
  }, [state, text, resetMs, onCopySuccess, onCopyError]);

  const Icon = state === "copied" ? Check : state === "error" ? AlertCircle : Copy;
  const resolvedTone = state === "error" ? "danger" : state === "copied" ? "success" : tone;

  return (
    <Button
      {...props}
      size={size}
      variant={variant}
      tone={resolvedTone}
      iconOnly={!label}
      aria-label={props["aria-label"] ?? "Copy"}
      onClick={handleCopy}
      leadingIcon={<Icon size={13} />}
    >
      {label}
    </Button>
  );
}
