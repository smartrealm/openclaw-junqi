// CopyButton 使用空闲、已复制和失败三态，并同步图标与无障碍名称。
// 交互结构沿用 Hermes shared-ui 的 CopyButton 模式。
import { useState, useCallback, type ReactNode } from "react";
import { Copy, Check, AlertCircle } from "lucide-react";
import { Button, type ButtonProps } from "../button";

type CopyState = "idle" | "copied" | "error";

export interface CopyButtonProps extends Omit<ButtonProps, "onClick" | "children" | "leadingIcon"> {
  /** 要复制的文本，或返回文本的异步工厂。 */
  text: string | (() => string | Promise<string>);
  /** 已复制或失败状态的保留毫秒数，默认 1800。 */
  resetMs?: number;
  /** 可选可见标签；省略时显示为纯图标按钮。 */
  label?: ReactNode;
  /** 已复制状态使用的无障碍名称。 */
  copiedLabel?: string;
  /** 失败状态使用的无障碍名称。 */
  errorLabel?: string;
  /** 剪贴板写入成功后调用。 */
  onCopySuccess?: (value: string) => void;
  /** 解析文本或写入剪贴板失败时调用。 */
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
  copiedLabel,
  errorLabel,
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
  const idleLabel = props["aria-label"] ?? "Copy";
  const stateLabel = state === "copied"
    ? copiedLabel ?? idleLabel
    : state === "error"
      ? errorLabel ?? idleLabel
      : idleLabel;

  return (
    <Button
      {...props}
      size={size}
      variant={variant}
      tone={resolvedTone}
      iconOnly={!label}
      aria-label={stateLabel}
      title={stateLabel}
      onClick={handleCopy}
      leadingIcon={<Icon size={13} aria-hidden="true" />}
    >
      {label}
    </Button>
  );
}
