import type { Messages } from '../i18n/messages';
import { formatAmount, formatPct, reportTable } from './report-format';
import type { RevenueReport } from './types';

export interface ExportMeta {
  /** e.g. "Period: 01.11.2026 – 30.11.2026 · Sport: All · Court: All courts" */
  filtersLine: string;
  generatedLine: string;
  fileBase: string;
}

/**
 * Excel file with formatted numbers and SUM formulas in the total row.
 * The library is loaded only when exporting, so it does not slow down the app.
 */
export async function exportXlsx(report: RevenueReport, m: Messages, meta: ExportMeta): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const table = reportTable(report, m);
  const bold = { fontWeight: 'bold' as const };
  const firstDataRow = 5; // 1-based: title, filters, generated, empty, header => data starts at row 6
  const lastDataRow = firstDataRow + table.rows.length;
  const columnLetter = (i: number) => String.fromCharCode(65 + i);

  const header = table.header.map((value) => ({ value, ...bold, backgroundColor: '#E2E8F0', wrap: true }));
  const rows = table.rows.map(([label, ...nums]) => [
    { value: label },
    ...nums.map((n, i) => (n === null ? null : { value: n, type: Number, format: i === 6 ? '0.0' : '#,##0' })),
  ]);
  const total = [
    { value: table.total[0], ...bold },
    ...table.total.slice(1).map((n, i) =>
      i === 6
        ? n === null
          ? null
          : { value: n as number, type: Number, format: '0.0', ...bold }
        : {
            value: `SUM(${columnLetter(i + 1)}${firstDataRow + 1}:${columnLetter(i + 1)}${lastDataRow})`,
            type: 'Formula' as const,
            format: '#,##0',
            ...bold,
          },
    ),
  ];

  await writeXlsxFile(
    [
      [{ value: `${m.reports.title} – BookTheCourt`, fontWeight: 'bold', fontSize: 14 }],
      [{ value: meta.filtersLine }],
      [{ value: meta.generatedLine }],
      [],
      header,
      ...rows,
      total,
    ],
    { sheet: m.reports.title.slice(0, 31), columns: [{ width: 26 }, ...table.header.slice(1).map(() => ({ width: 15 }))], stickyRowsCount: 5 },
  ).toFile(`${meta.fileBase}.xlsx`);
}

/** PDF with a summary and the full table. Uses pdfmake's bundled Roboto font, which includes č ć š ž đ. */
export async function exportPdf(report: RevenueReport, m: Messages, meta: ExportMeta): Promise<void> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.addVirtualFileSystem(vfs);
  const table = reportTable(report, m);
  const money = (n: number) => `${formatAmount(n, m.locale)} ${report.currency}`;
  const cell = (n: number | null, i: number) => (n === null ? '—' : i === 6 ? formatPct(n, m.locale) : i === 0 || i === 4 ? String(n) : formatAmount(n, m.locale));
  const t = report.totals;
  const summary = [
    [m.reports.realized, money(t.realized)],
    [m.reports.estimated, money(t.estimated)],
    [m.reports.total, money(t.total)],
    [m.reports.bookings, String(t.bookings)],
    [m.reports.cancelled, `${t.cancelledCount} (${money(t.cancelledAmount)})`],
    [m.reports.occupancy, formatPct(t.occupancyPct, m.locale)],
  ];

  await pdfMake
    .createPdf({
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [36, 40, 36, 40],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      info: { title: m.reports.title, author: 'BookTheCourt' },
      footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'right', margin: [0, 10, 36, 0], fontSize: 8, color: '#64748b' }),
      content: [
        { text: `${m.reports.title} – BookTheCourt`, fontSize: 16, bold: true },
        { text: meta.filtersLine, margin: [0, 4, 0, 0], color: '#334155' },
        { text: meta.generatedLine, margin: [0, 2, 0, 12], color: '#64748b', fontSize: 8 },
        {
          table: { widths: ['auto', 'auto'], body: summary.map(([k, v]) => [{ text: k, color: '#475569' }, { text: v, bold: true }]) },
          layout: 'noBorders',
          margin: [0, 0, 0, 14],
        },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
            body: [
              table.header.map((h, i) => ({ text: h, bold: true, fillColor: '#e2e8f0', alignment: i === 0 ? 'left' : 'right' })),
              ...table.rows.map(([label, ...nums]) => [label, ...nums.map((n, i) => ({ text: cell(n, i), alignment: 'right' as const }))]),
              [
                { text: table.total[0], bold: true },
                ...table.total.slice(1).map((n, i) => ({ text: cell(n as number | null, i), bold: true, alignment: 'right' as const })),
              ],
            ],
          },
          layout: {
            hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length - 1 || i === node.table.body.length ? 1 : 0.5),
            vLineWidth: () => 0,
            hLineColor: () => '#cbd5e1',
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        },
      ],
    })
    .download(`${meta.fileBase}.pdf`);
}
