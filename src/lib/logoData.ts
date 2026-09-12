import logo from "@/assets/bms-logo.png.asset.json";

let cached: string | null = null;

/** Fetches the BMS logo and returns a base64 data URL for use in PDF/DOCX. */
export async function getLogoDataUrl(): Promise<string | null> {
  if (cached) return cached;
  try {
    const res = await fetch(logo.url);
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

export async function getLogoBytes(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(logo.url);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
