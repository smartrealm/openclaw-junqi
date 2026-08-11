import QRCode from "qrcode";

/**
 * 将 OpenClaw 返回的不透明载荷在本地编码为二维码。该过程不访问载荷指向的
 * 网络资源，也不把渲染成功解释为渠道已经授权。
 */
export async function renderLocalQrDataUrl(content: string): Promise<string | null> {
  const payload = content.trim();
  if (!payload || payload.length > 16 * 1024 || /[\u0000-\u001F\u007F]/.test(payload)) {
    return null;
  }
  try {
    return await QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 512,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });
  } catch {
    return null;
  }
}
