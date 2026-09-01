import fs from 'fs';
import zlib from 'zlib';

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

if (!fs.existsSync('./data/spool_virtual')) {
  fs.mkdirSync('./data/spool_virtual', { recursive: true });
}

fs.writeFileSync('./data/spool_virtual/test_spool_bill.spl', zipBuf);
console.log('✅ Spool file test_spool_bill.spl successfully written to data/spool_virtual!');
