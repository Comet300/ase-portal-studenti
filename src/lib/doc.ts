import { escapeHtml } from './mail'

/**
 * Printable documents.
 *
 * The faculty still runs on paper for the parts that need a signature, so these
 * are A4-first: a print stylesheet, no portal chrome, and a button that is gone
 * the moment the page is printed.
 */
export function renderDoc(title: string, body: string, reference?: string): string {
  return `<!doctype html>
<html lang="ro"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  /* Numărul paginii în subsol: o cerere semnată circulă pe hârtie prin
     secretariat, iar o foaie desprinsă dintr-un teanc trebuie să spună din ce
     document face parte și a câta este. */
  @page {
    size: A4;
    margin: 25mm 20mm;
    @bottom-center { content: counter(page) " / " counter(pages); font: 9pt Georgia, serif; color: #5b6169; }
  }
  body { font: 12pt/1.6 Georgia, 'Times New Roman', serif; color: #1a1e23; max-width: 17cm; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 15pt; text-align: center; margin-bottom: 4pt; }
  h2 { font-size: 12pt; margin-top: 20pt; }
  .head { text-align: center; border-bottom: 2px solid #990000; padding-bottom: 10pt; margin-bottom: 20pt; }
  .head strong { display: block; font-size: 11pt; }
  .head span { font-size: 10pt; color: #40464e; }
  .blank { border-bottom: 1px dotted #5b6169; display: inline-block; min-width: 6cm; }
  .signatures { display: flex; justify-content: space-between; margin-top: 40pt; font-size: 11pt; }
  .note { font-size: 9pt; color: #5b6169; margin-top: 24pt; border-top: 1px solid #e9ecef; padding-top: 8pt; }
  .referinta { font-size: 8pt; color: #767c85; margin-top: 18pt; text-align: right; }
  .box { border: 1px solid #c9ced4; padding: 10pt 12pt; margin: 10pt 0; }
  dl.record { display: grid; grid-template-columns: 5.5cm 1fr; gap: 4pt 10pt; margin: 12pt 0; font-size: 11pt; }
  dl.record dt { color: #40464e; }
  dl.record dd { margin: 0; }
  ol, ul { padding-left: 18pt; }
  .print { position: fixed; top: 12px; right: 12px; font: 600 13px/1 -apple-system, sans-serif;
           background: #990000; color: #fff; border: 0; padding: 10px 16px; border-radius: 4px; cursor: pointer; }
  @media print { .print { display: none; } body { margin: 0; } }
</style></head>
<body>
<button class="print" onclick="window.print()">Tipărește / Salvează PDF</button>
<div class="head">
  <strong>ACADEMIA DE STUDII ECONOMICE DIN BUCUREȘTI</strong>
  <span>Facultatea de Marketing · Sesiunea de Finalizare a Studiilor</span>
</div>
${body}
${
  reference
    ? `<p class="referinta">Document generat din Portalul Studenți · ${escapeHtml(reference)}</p>`
    : ''
}
</body></html>`
}
