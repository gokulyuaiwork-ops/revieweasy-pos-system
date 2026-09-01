import zlib from 'zlib';
import { parseReceiptStream } from '../src/engine/parser.js';

export function extractXpsTextFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return '';
  
  const textMatches = [];

  // Check if buffer starts with PK\x03\x04 (ZIP container for XPS / OpenXPS)
  if (buffer.length > 30 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    let offset = 0;
    while (offset < buffer.length - 30) {
      if (buffer[offset] === 0x50 && buffer[offset+1] === 0x4B && buffer[offset+2] === 0x03 && buffer[offset+3] === 0x04) {
        const compressionMethod = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const fileNameLength = buffer.readUInt16LE(offset + 26);
        const extraFieldLength = buffer.readUInt16LE(offset + 28);
        
        const fileNameStart = offset + 30;
        const fileNameEnd = fileNameStart + fileNameLength;
        
        const dataStart = fileNameEnd + extraFieldLength;
        const dataEnd = dataStart + compressedSize;

        if (dataEnd <= buffer.length) {
          const rawData = buffer.slice(dataStart, dataEnd);
          let uncompressedXml = '';

          if (compressionMethod === 0) {
            uncompressedXml = rawData.toString('utf8');
          } else if (compressionMethod === 8) { // DEFLATE
            try {
              uncompressedXml = zlib.inflateRawSync(rawData).toString('utf8');
            } catch (e) {}
          }

          if (uncompressedXml) {
            const unicodeStringRegex = /UnicodeString=["']([^"']+)["']/g;
            let m;
            while ((m = unicodeStringRegex.exec(uncompressedXml)) !== null) {
              textMatches.push(m[1]);
            }
          }
        }
        offset = dataEnd > offset ? dataEnd : offset + 1;
      } else {
        offset++;
      }
    }
  }

  // Also check for uncompressed XML UnicodeString
  const rawStr = buffer.toString('utf8');
  const directRegex = /UnicodeString=["']([^"']+)["']/g;
  let dm;
  while ((dm = directRegex.exec(rawStr)) !== null) {
    if (!textMatches.includes(dm[1])) {
      textMatches.push(dm[1]);
    }
  }

  return textMatches.join('\n');
}

// Test packaging
const xml = '<FixedPage><Glyphs UnicodeString="DEMO BUSINESS"/><Glyphs UnicodeString="Ph: 9342350747"/><Glyphs UnicodeString="Customer: Test Customer"/><Glyphs UnicodeString="Mobile: 9342350747"/><Glyphs UnicodeString="General Service 1500.00"/><Glyphs UnicodeString="TOTAL: ₹1500.00"/></FixedPage>';
const compressed = zlib.deflateRawSync(Buffer.from(xml, 'utf8'));
const fileName = Buffer.from('Documents/1/Pages/1.fpage', 'utf8');
const header = Buffer.alloc(30);
header.writeUInt32LE(0x04034B50, 0);
header.writeUInt16LE(20, 4);
header.writeUInt16LE(0, 6);
header.writeUInt16LE(8, 8);
header.writeUInt32LE(0, 10);
header.writeUInt32LE(compressed.length, 18);
header.writeUInt32LE(Buffer.byteLength(xml), 22);
header.writeUInt16LE(fileName.length, 26);
header.writeUInt16LE(0, 28);
const zipBuf = Buffer.concat([header, fileName, compressed]);

const extracted = extractXpsTextFromBuffer(zipBuf);
console.log('Extracted XPS Text:\n', extracted);

const parsed = parseReceiptStream(extracted);
console.log('\nParsed Bill from XPS Spool:\n', parsed);
