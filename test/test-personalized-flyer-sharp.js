import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testSharpPersonalization() {
  console.log('Testing Sharp Personalized Image Generation...');

  // Create a base solid/test image buffer
  const baseBuffer = await sharp({
    create: {
      width: 1000,
      height: 1200,
      channels: 3,
      background: { r: 30, g: 41, b: 59 }
    }
  }).jpeg().toBuffer();

  const customerName = 'Rahul Sharma';
  const text = `Specially for ${customerName}! ✨`;
  const overlaySvg = `
    <svg width="1000" height="1200" viewBox="0 0 1000 1200">
      <rect x="250" y="180" width="500" height="80" rx="20" ry="20" fill="rgba(0,0,0,0.8)"/>
      <text x="500" y="220" font-family="sans-serif" font-weight="bold" font-size="32" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">
        ${text}
      </text>
    </svg>
  `;

  const compositeBuffer = await sharp(baseBuffer)
    .composite([{ input: Buffer.from(overlaySvg, 'utf8'), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();

  console.log('✅ Composite JPEG Image successfully created! Size:', compositeBuffer.length, 'bytes');
  console.log('Valid JPEG Header:', compositeBuffer[0] === 0xFF && compositeBuffer[1] === 0xD8);
}

testSharpPersonalization().catch(console.error);
