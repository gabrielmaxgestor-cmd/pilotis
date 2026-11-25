const windowsAnsi = '€\u0000‚ƒ„…†‡ˆ‰Š‹Œ\u0000Ž\u0000\u0000‘’“”•–—˜™š›œ\u0000žŸ';

export function pdfText(value: string, replaceUnsupported = false): string {
  return Array.from(value.normalize('NFC'), (character) => {
    const code = character.charCodeAt(0);
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      return code.toString(16).padStart(2, '0');
    }
    const offset = windowsAnsi.indexOf(character);
    if (offset >= 0) return (128 + offset).toString(16);
    if (replaceUnsupported) return '3f';
    throw new Error('O contrato contém um caractere que não pode ser incluído no PDF.');
  }).join('');
}

export function createPdfDocument(objects: string[]): Uint8Array {
  // All objects use ASCII syntax, so string offsets are also byte offsets.
  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  for (const [index, object] of objects.entries()) {
    offsets.push(String(pdf.length).padStart(10, '0') + ' 00000 n \n');
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = pdf.length;
  pdf += 'xref\n0 ' + offsets.length + '\n' + offsets.join('') +
    'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return new TextEncoder().encode(pdf);
}
