const logo = { url: "/bms-logo.png" };

let cached: string | null = null;
const imageCache = new Map<string, string>();

/** Fetches the BMS logo and returns a base64 data URL for use in PDF/DOCX. */
export async function getLogoDataUrl(timeoutMs = 2000): Promise<string | null> {
  if (cached) return cached;
  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), timeoutMs);
    const res = await fetch(logo.url, { signal: controller?.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    cached = url;
    return url;
  } catch {
    return null;
  }
}

export async function getLogoBytes(timeoutMs = 2000): Promise<Uint8Array | null> {
  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), timeoutMs);
    const res = await fetch(logo.url, { signal: controller?.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Safely resolves an image URL (data URL or remote HTTP/HTTPS/R2 asset) to a base64 data URL.
 * Fails safely within timeoutMs so PDF generation never blocks or crashes on slow/broken assets.
 */
export async function safeResolveImageDataUrl(url?: string | null, timeoutMs = 2500): Promise<string | null> {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Direct data URL
  if (trimmed.startsWith("data:image/")) return trimmed;

  // Check in-memory cache
  if (imageCache.has(trimmed)) return imageCache.get(trimmed)!;

  // If running in environment without window/fetch
  if (typeof fetch === "undefined") return null;

  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), timeoutMs);
    const res = await fetch(trimmed, { signal: controller?.signal, mode: "cors" });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") && blob.type !== "application/octet-stream") return null;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });

    if (dataUrl && dataUrl.startsWith("data:image/")) {
      imageCache.set(trimmed, dataUrl);
      return dataUrl;
    }
    return null;
  } catch {
    return null;
  }
}
