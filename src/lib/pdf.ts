import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export async function downloadPDF(elementId: string, filename: string): Promise<void> {
  const el = document.getElementById(elementId);
  if (!el) throw new Error("Element not found");
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const img = canvas.toDataURL("image/jpeg", 0.95);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  if (imgH <= pageH) {
    pdf.addImage(img, "JPEG", 0, 0, imgW, imgH);
  } else {
    let remaining = imgH;
    let y = 0;
    while (remaining > 0) {
      pdf.addImage(img, "JPEG", 0, y, imgW, imgH);
      remaining -= pageH;
      y -= pageH;
      if (remaining > 0) pdf.addPage();
    }
  }
  pdf.save(filename);
}

export function printElement(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) { window.print(); return; }
  const styles = Array.from(document.querySelectorAll("link[rel=stylesheet], style"))
    .map(node => node.outerHTML).join("\n");
  w.document.write(`<!doctype html><html><head><title>Print</title>${styles}
    <style>@page{size:A4;margin:12mm} body{background:white;font-family:Inter,sans-serif}</style>
  </head><body>${el.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 300);
}
