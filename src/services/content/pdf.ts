/**
 * PDF.js loader shared by the read-only PDF object reader and the print
 * preview of generated PDFs. Rendering only — Leafor has no PDF editing.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

let configured = false;
function configure() {
  if (configured) return;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  configured = true;
}

/** Offline resources (CJK CMaps, standard fonts) are bundled under /pdfjs/. */
const base = typeof document !== "undefined" ? new URL("pdfjs/", document.baseURI).href : "/pdfjs/";

export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  configure();
  const task = pdfjs.getDocument({
    data: bytes,
    password,
    cMapUrl: base + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: base + "standard_fonts/",
    wasmUrl: base + "wasm/",
    iccUrl: base + "iccs/",
    enableXfa: false,
  });
  return task.promise;
}

export interface PdfOutlineNode {
  title: string;
  pageIndex: number | null;
  children: PdfOutlineNode[];
}

export async function readOutline(doc: PDFDocumentProxy): Promise<PdfOutlineNode[]> {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline) return [];
  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      const d = typeof dest === "string" ? await doc.getDestination(dest) : (dest as unknown[]);
      if (!d || !d[0]) return null;
      return await doc.getPageIndex(d[0] as never);
    } catch {
      return null;
    }
  };
  const walk = async (items: typeof outline): Promise<PdfOutlineNode[]> =>
    Promise.all(items.map(async (o) => ({ title: o.title, pageIndex: await resolve(o.dest), children: await walk(o.items ?? []) })));
  return walk(outline);
}

export { pdfjs };
export type { PDFDocumentProxy };
