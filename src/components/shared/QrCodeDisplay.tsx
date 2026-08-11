import { LoaderCircle, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { renderLocalQrDataUrl } from "@/utils/qrCode";

export type QrCodeDisplayState = "loading" | "ready" | "unavailable";

export function QrCodeDisplay({
  content,
  dataUrl,
  alt,
  className = "h-48 w-48",
}: {
  content?: string | null;
  dataUrl?: string | null;
  alt: string;
  className?: string;
}) {
  const [rendered, setRendered] = useState<{
    content: string | null;
    dataUrl: string | null;
    resolved: boolean;
  }>(() => ({ content: content ?? null, dataUrl: null, resolved: false }));
  const contentMatches = rendered.content === (content ?? null);
  const localDataUrl = contentMatches ? rendered.dataUrl : null;
  const resolvedDataUrl = dataUrl || localDataUrl;
  const state: QrCodeDisplayState = resolvedDataUrl
    ? "ready"
    : content && (!contentMatches || !rendered.resolved)
      ? "loading"
      : "unavailable";

  useEffect(() => {
    let active = true;
    setRendered({ content: content ?? null, dataUrl: null, resolved: false });
    if (!content) {
      return () => {
        active = false;
      };
    }
    void renderLocalQrDataUrl(content).then((nextDataUrl) => {
      if (!active) return;
      setRendered({ content, dataUrl: nextDataUrl, resolved: true });
    });
    return () => {
      active = false;
    };
  }, [content]);

  return (
    <div
      data-qr-display={state}
      className={`grid place-items-center overflow-hidden rounded-lg border border-aegis-border bg-white p-2 ${className}`}
    >
      {resolvedDataUrl ? (
        <img src={resolvedDataUrl} alt={alt} className="h-full w-full object-contain" />
      ) : state === "loading" ? (
        <LoaderCircle role="status" aria-label={alt} size={22} className="animate-spin text-aegis-primary" />
      ) : (
        <QrCode aria-label={alt} size={24} className="text-aegis-text-dim" />
      )}
    </div>
  );
}
