import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dynamic Personalized Flyer Generator
 * Generates custom customer-personalized flyer JPEG image buffers with dynamic name overlays
 */
export class PersonalizedImageGenerator {
  /**
   * Default overlay styling configuration
   */
  static getDefaultOverlayConfig() {
    return {
      enabled: true,
      template: "Specially for {{name}}! ✨",
      posX: 50, // 50% = horizontal center
      posY: 18, // 18% from top
      fontSize: 32,
      color: "#FFFFFF",
      badgeBg: "rgba(0, 0, 0, 0.75)",
      fontFamily: "Arial, sans-serif",
      fontWeight: "800",
      showBadge: true,
      textShadow: true,
      borderRadius: 16
    };
  }

  /**
   * Format customer name for overlay
   */
  static formatCustomerName(rawName = '') {
    if (!rawName || rawName === 'Valued Customer' || rawName === 'N/A' || rawName.trim() === '') {
      return 'Valued Guest';
    }
    const clean = rawName.trim().replace(/[^\w\s\.\-]/gi, '');
    return clean.length > 0 ? clean : 'Valued Guest';
  }

  /**
   * Generate formatted banner text based on template
   */
  static renderTemplateText(template, customerName) {
    const fullName = this.formatCustomerName(customerName);
    const firstName = fullName.split(' ')[0] || fullName;
    const tmpl = template || "Specially for {{name}}! ✨";
    return tmpl
      .replace(/\{\{\s*name\s*\}\}/gi, fullName)
      .replace(/\{\{\s*first_name\s*\}\}/gi, firstName);
  }

  /**
   * Generates a composite personalized JPEG image buffer
   * 
   * @param {Buffer} baseImageBuffer - The raw image buffer (JPEG/PNG)
   * @param {string} customerName - The extracted customer name
   * @param {object} overlayConfig - Position, template, color & typography settings
   * @returns {Promise<Buffer>} - Personalized JPEG image buffer ready for WhatsApp delivery
   */
  static async generatePersonalizedFlyer(baseImageBuffer, customerName, overlayConfig = {}) {
    const config = { ...this.getDefaultOverlayConfig(), ...overlayConfig };
    if (!config.enabled || !baseImageBuffer || !Buffer.isBuffer(baseImageBuffer)) {
      return baseImageBuffer;
    }

    try {
      const renderedText = this.renderTemplateText(config.template, customerName);

      // Dimensions for standard high-resolution 1000x1200 social flyer
      const canvasWidth = 1000;
      const canvasHeight = 1200;

      const posX = Math.round((config.posX / 100) * canvasWidth);
      const posY = Math.round((config.posY / 100) * canvasHeight);
      const fontSize = config.fontSize || 32;
      const textColor = config.color || '#FFFFFF';
      const badgeBg = config.badgeBg || 'rgba(0, 0, 0, 0.75)';
      const showBadge = config.showBadge !== false;

      // Approximate text bounding box for background pill badge
      const approxCharWidth = fontSize * 0.58;
      const textWidth = Math.min(canvasWidth - 80, Math.round(renderedText.length * approxCharWidth + 56));
      const badgeHeight = Math.round(fontSize * 1.8);
      const badgeX = Math.max(20, Math.min(canvasWidth - textWidth - 20, posX - Math.round(textWidth / 2)));
      const badgeY = Math.max(20, Math.min(canvasHeight - badgeHeight - 20, posY - Math.round(badgeHeight / 2)));

      const overlaySvg = `
        <svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
          <style>
            .banner-text {
              font-family: ${config.fontFamily || 'Arial, sans-serif'};
              font-weight: 800;
              font-size: ${fontSize}px;
              fill: ${textColor};
              text-anchor: middle;
              dominant-baseline: central;
            }
          </style>
          ${showBadge ? `
            <rect x="${badgeX}" y="${badgeY}" width="${textWidth}" height="${badgeHeight}" rx="${config.borderRadius || 16}" ry="${config.borderRadius || 16}" fill="${badgeBg}" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
          ` : ''}
          <text x="${posX}" y="${posY}" class="banner-text">
            ${this.escapeXml(renderedText)}
          </text>
        </svg>
      `;

      // Composite dynamic name overlay onto the flyer image
      const finalImageBuffer = await sharp(baseImageBuffer)
        .resize(canvasWidth, canvasHeight, { fit: 'cover' })
        .composite([{ input: Buffer.from(overlaySvg, 'utf8'), top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toBuffer();

      return finalImageBuffer;
    } catch (err) {
      console.error('[Personalized Flyer] Sharp compositing error:', err.message);
      return baseImageBuffer;
    }
  }

  /**
   * Escape XML/SVG special characters
   */
  static escapeXml(str = '') {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
