type ReceiptDocument = {
  number: string; cardLast4: string; createdAt: string;
  snapshot: unknown;
};

type ReceiptSnapshot = {
  branchName?: string; tableNumber?: number | null;
  items: { name: string; quantity: number; lineTotal: string }[];
  subtotal: string; discount: string; tax: string; total: string;
};

export function receiptPdf(receipt: ReceiptDocument): Buffer {
  const snapshot = receipt.snapshot as ReceiptSnapshot;
  const lines = [
    `Comprobante ${receipt.number}`, `Fecha: ${receipt.createdAt}`,
    `Sucursal: ${snapshot.branchName ?? ''}`,
    snapshot.tableNumber ? `Mesa ${snapshot.tableNumber}` : 'Para llevar',
    `Tarjeta **** ${receipt.cardLast4}`,
    ...snapshot.items.flatMap(item => {
      const text = `${item.quantity} x ${item.name}  $${item.lineTotal}`;
      return text.match(/.{1,80}/gu) ?? [];
    }),
    `Subtotal: $${snapshot.subtotal}`, `Descuento: $${snapshot.discount}`,
    `IVA: $${snapshot.tax}`, `Total: $${snapshot.total}`,
  ];
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += 44) pages.push(lines.slice(i, i + 44));
  const safe = (value: string) => value.replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/[()\\]/g, '\\$&');
  const pageIds = pages.map((_, i) => 4 + i * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((page, index) => {
    const content = `BT /F1 11 Tf 50 780 Td 16 TL ${page.map((line, i) => `${i ? 'T* ' : ''}(${safe(line)}) Tj`).join('\n')} ET\nBT /F1 9 Tf 50 35 Td (Pagina ${index + 1} / ${pages.length}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  });
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
