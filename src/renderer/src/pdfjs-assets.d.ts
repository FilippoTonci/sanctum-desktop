// Vite `?url` import of the bundled PDF.js worker (see review/pdfjs.ts).
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url' {
  const url: string
  export default url
}
