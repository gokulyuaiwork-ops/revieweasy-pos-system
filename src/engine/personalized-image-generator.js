import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Dynamic Personalized Flyer Generator
 * Generates custom customer-personalized flyer image buffers with dynamic name overlays
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
      fontSize: 28,
      color: "#FFFFFF",
      badgeBg: "rgba(0, 0, 0, 0.70)",
      fontFamily: "Plus Jakarta Sans, sans-serif",
      fontWeight: "800",
      showBadge: true,
      textShadow: true,
      borderRadius: 12
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
   * Generates a composite personalized SVG / Image buffer
   * 
   * @param {Buffer} baseImageBuffer - The raw image buffer (JPEG/PNG)
   * @param {string} customerName - The extracted customer name
   * @param {object} overlayConfig - Position, template, color & typography settings
   * @returns {Buffer} - Personalized image buffer ready for WhatsApp delivery
   */
  static generatePersonalizedFlyer(baseImageBuffer, customerName, overlayConfig = {}) {
    const config = { ...this.getDefaultOverlayConfig(), ...overlayConfig };
    if (!config.enabled || !baseImageBuffer) {
      return baseImageBuffer;
    }

    const renderedText = this.renderTemplateText(config.template, customerName);
    const base64Image = baseImageBuffer.toString('base64');
    const mimeType = 'image/jpeg';

    // Dimensions for high-resolution 1080x1350 or 800x1000 standard social flyer
    const canvasWidth = 1000;
    const canvasHeight = 1200;

    const posX = Math.round((config.posX / 100) * canvasWidth);
    const posY = Math.round((config.posY / 100) * canvasHeight);
    const fontSize = config.fontSize || 32;
    const textColor = config.color || '#FFFFFF';
    const badgeBg = config.badgeBg || 'rgba(0, 0, 0, 0.70)';
    const showBadge = config.showBadge !== false;

    // Approximate text bounding box for background pill badge
    const approxCharWidth = fontSize * 0.58;
    const textWidth = Math.min(canvasWidth - 80, Math.round(renderedText.length * approxCharWidth + 48));
    const badgeHeight = Math.round(fontSize * 1.7);
    const badgeX = Math.max(20, Math.min(canvasWidth - textWidth - 20, posX - Math.round(textWidth / 2)));
    const badgeY = Math.max(20, Math.min(canvasHeight - badgeHeight - 20, posY - Math.round(badgeHeight / 2)));

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <defs>
    <filter id="badgeShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
    <filter id="textGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.8"/>
    </filter>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800;900&amp;display=swap');
      .banner-text {
        font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
        font-weight: 800;
        font-size: ${fontSize}px;
        fill: ${textColor};
        text-anchor: middle;
        dominant-baseline: central;
      }
    </style>
  </defs>

  <!-- Base Brand Flyer Image -->
  <image href="data:${mimeType};base64,${base64Image}" width="${canvasWidth}" height="${canvasHeight}" preserveAspectRatio="xMidYMid slice"/>

  <!-- Dynamic Personalized Overlay Container -->
  <g transform="translate(0, 0)">
    ${showBadge ? `
    <!-- Contrast Pill Badge -->
    <rect x="${badgeX}" y="${badgeY}" width="${textWidth}" height="${badgeHeight}" rx="${config.borderRadius || 16}" ry="${config.borderRadius || 16}" fill="${badgeBg}" filter="url(#badgeShadow)" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
    ` : ''}

    <!-- Dynamic Customer Name Text -->
    <text x="${posX}" y="${posY}" class="banner-text" filter="url(#textGlow)">
      ${this.escapeXml(renderedText)}
    </text>
  </g>
</svg>`;

    return Buffer.from(svg, 'utf8');
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
