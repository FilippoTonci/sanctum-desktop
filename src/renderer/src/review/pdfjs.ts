/**
 * PDF.js loader for PdfView (Phase 3.5 WS4).
 *
 * - Imported lazily (`await import('./pdfjs')`) so the ~1.6 MB of PDF.js
 *   only loads when a PDF is opened; .docx review never pays for it.
 * - The worker is bundled by Vite from node_modules (`?url` emits it as a
 *   hashed asset next to the renderer bundle). No CDN, no runtime network:
 *   under `file://` in production and `http://localhost` in dev the worker
 *   URL is same-origin, which the CSP's `script-src 'self'` (the fallback
 *   for `worker-src`) already allows.
 * - The `legacy` build is deliberate: the modern 6.x build calls
 *   `Map.prototype.getOrInsertComputed`, `Math.sumPrecise`, `Promise.try`
 *   and friends, which Electron 33's Chromium 130 lacks. The legacy build
 *   ships core-js polyfills for them. Revisit when Electron is upgraded.
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'

export function loadPdf(data: ArrayBuffer): Promise<pdfjs.PDFDocumentProxy> {
  return pdfjs.getDocument({
    data,
    // Offline hardening: never fetch anything. Standard-14 fonts that are
    // not embedded fall back to system fonts (useSystemFonts); CMaps,
    // wasm image decoders and ICC profiles are not bundled (see the
    // WS4 report for what that costs).
    useSystemFonts: true,
    useWorkerFetch: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: false,
  }).promise
}
