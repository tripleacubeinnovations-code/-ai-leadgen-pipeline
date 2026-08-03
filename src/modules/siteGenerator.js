/**
 * Site Generator Module (100% FREE - Google Gemini REST API)
 * ---------------------------------------------------------
 * Uses Google Gemini API (via fast direct fetch) to generate a single-file HTML/CSS website
 * for each lead.
 *
 * REQUIRES NO CREDIT CARD! Free from https://aistudio.google.com/app/apikey
 *
 * Exports:
 *   generateSite(lead) → { html, filePath, fileName }
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import config, { requireConfig } from '../config.js';

const SYSTEM_PROMPT = `You are an elite web designer and frontend developer. Create a single-file HTML page (with all CSS embedded in a <style> tag) for a local business.

STRICT RULES:
1. Output ONLY raw HTML code. Do NOT wrap in markdown code blocks like \`\`\`html.
2. First character MUST be "<!DOCTYPE html>" or "<html".
3. Mobile responsive, modern CSS, gradients, card shadows, Google Fonts link in <head>.
4. Mandatory Sections:
   - HERO: Business Name, industry tagline, CTA button ("Get a Free Quote").
   - ABOUT: 2-3 realistic, professional paragraphs tailored to their city.
   - CONTACT: Phone number, Address, clean contact form with Name/Email/Message fields.
   - FOOTER: Business Name, copyright year.`;

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
 * Generate a single-page HTML website for a lead using Gemini REST API.
 *
 * @param {object} lead
 * @returns {Promise<{ html: string, filePath: string, fileName: string }>}
 */
export async function generateSite(lead) {
  requireConfig();

  console.log(`🎨 Generating website via Gemini AI for: ${lead.name} (${lead.category})`);

  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(lead)}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  let html = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

  // Strip markdown code fences if present
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
