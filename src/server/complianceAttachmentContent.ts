import { inflateRawSync } from 'node:zlib';
import type { ComplianceMime } from '../domain/complianceAttachments.ts';

const DOCX: ComplianceMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isWordDocumentZip(bytes: Buffer) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break;
  }
  if (end < Math.max(0, bytes.length - 65557) || bytes.readUInt32LE(end + 4) !== 0) return false;
  const entries = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  let at = bytes.readUInt32LE(end + 16);
  if (!entries || entries > 5000 || entries !== bytes.readUInt16LE(end + 8) || at + size !== end) return false;
  let foundDocument = false;
  let foundTypes = false;
  for (let i = 0; i < entries; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) return false;
    const nameSize = bytes.readUInt16LE(at + 28);
    const next = at + 46 + nameSize + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    if (next > end) return false;
    const name = bytes.toString('utf8', at + 46, at + 46 + nameSize);
    if (name === 'word/document.xml') foundDocument = true;
    if (name === '[Content_Types].xml') {
      const local = bytes.readUInt32LE(at + 42);
      if (local + 30 > at || bytes.readUInt32LE(local) !== 0x04034b50 || (bytes.readUInt16LE(at + 8) & 1)) return false;
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const stop = start + bytes.readUInt32LE(at + 20);
      if (stop > at || bytes.readUInt32LE(at + 24) > 128 * 1024) return false;
      const method = bytes.readUInt16LE(at + 10);
      const block = bytes.subarray(start, stop);
      try {
        const xml = (method === 8 ? inflateRawSync(block, { maxOutputLength: 128 * 1024 }) :
          method === 0 ? block : Buffer.alloc(0)).toString('utf8');
        foundTypes = xml.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');
      } catch { return false; }
    }
    at = next;
  }
  return at === end && foundDocument && foundTypes;
}

export function detectComplianceMime(bytes: Buffer): ComplianceMime | null {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  return isWordDocumentZip(bytes) ? DOCX : null;
}
