/**
 * Site Generator Module (100% FREE - Google Gemini API)
 * ---------------------------------------------------
 * Uses Google Gemini (via @google/generative-ai) to generate a single-file HTML/CSS website
 * for each lead.
 *
 * REQUIRES NO CREDIT CARD! Free from https://aistudio.google.com/app/apikey
 *
 * Exports:
 *   generateSite(lead) → { html, filePath, fileName }
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config, { requireConfig } from '../config.js';

let genAI = null;

function getGeminiModel() {
  if (!genAI) {
    requireConfig();
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI.getGenerativeModel({ model: config.geminiModel });
}

const SYSTEM_PROMPT = `You are an elite web designer and frontend developer. Create a single-file HTML page (with all CSS embedded in a <style> tag) for a local business.

STRICT RULES:
1. Output ONLY raw HTML code. Do NOT wrap in markdown code blocks like \`\`\`html.
2. First character MUST be "<!DOCTYPE html>" or "<html".
3. Mobile responsive, modern CSS, gradients, card shadows, Google Fonts link in <head>.
4. Industry-tailored color palette and typography.
5. Mandatory Sections:
   - HERO: Business Name, industry tagline, CTA button ("Get a Free Quote" / "Book Appointment").
   - ABOUT: 2-3 realistic, professional paragraphs tailored to their city/area.
   - CONTACT: Phone number, Address, clean contact form with Name/Email/Message fields.
   - FOOTER: Business Name, copyright year, tagline.
6. Hover effects, subtle fade animations, smooth scrolling.`;

function buildUserPrompt(lead) {
  return `Create a high-converting landing page for:

Business Name: ${lead.name}
Category/Industry: ${lead.category}
City: ${lead.city}
Address: ${lead.address}
Phone: ${lead.phone || 'Contact for details'}

Make it look like a high-end $2,000 custom website!`;
}

/**
 * Generate a single-page HTML website for a lead using Google Gemini API.
 *
 * @param {object} lead
 * @returns {Promise<{ html: string, filePath: string, fileName: string }>}
 */
export async function generateSite(lead) {
  const model = getGeminiModel();

  console.log(`🎨 Generating website via Gemini AI for: ${lead.name} (${lead.category})`);

  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(lead)}`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  let html = response.text().trim();

  // Strip markdown code fences if model outputted them
  html = html.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim();

  if (!html.toLowerCase().startsWith('<!doctype') && !html.toLowerCase().startsWith('<html')) {
    const htmlMatch = html.match(/<!DOCTYPE html>[\s\S]*<\/html>/i) ||
                      html.match(/<html[\s\S]*<\/html>/i);
    if (htmlMatch) {
      html = htmlMatch[0];
    }
  }

  // Save HTML file locally
  await mkdir(config.generatedSitesDir, { recursive: true });
  const fileName = `${lead.slug}.html`;
  const filePath = path.join(config.generatedSitesDir, fileName);
  await writeFile(filePath, html, 'utf-8');

  console.log(`   ✅ Gemini Site generated & saved: ${fileName} (${(html.length / 1024).toFixed(1)} KB)`);

  return { html, filePath, fileName };
}

export default { generateSite };
