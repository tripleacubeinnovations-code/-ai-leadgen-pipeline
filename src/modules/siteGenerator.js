/**
 * Site Generator Module
 * ---------------------
 * Uses the OpenAI API to generate a beautiful, single-file HTML/CSS website
 * for each lead, tailored to their business name, category, and city.
 *
 * Exports:
 *   generateSite(lead) → { html, filePath }
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import config, { requireConfig } from '../config.js';

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    requireConfig('OpenAI API');
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

// ---------------------------------------------------------------------------
// Prompt Engineering
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an elite web designer and frontend developer. Your task is to create a single-file HTML page (with all CSS embedded in a <style> tag) for a local business.

STRICT RULES:
1. Output ONLY the raw HTML code. No markdown, no explanations, no code fences.
2. The first character of your response must be "<!DOCTYPE html>" or "<html".
3. The page MUST be mobile-responsive.
4. Use modern CSS — gradients, box-shadows, smooth transitions, Google Fonts (link in <head>).
5. Choose colors, fonts, and imagery style appropriate to the business's industry.
6. Include ONLY these sections:
   - HERO: Large heading with business name, a compelling tagline for their industry, and a CTA button ("Contact Us" or "Get a Quote").
   - ABOUT: 2-3 paragraphs about the business — write realistic, professional copy as if you were the business owner. Mention the city/area they serve.
   - CONTACT: Display phone number (if provided), address, and a simple contact form (name, email, message fields + submit button). The form action can be "#".
   - FOOTER: Business name, copyright year, small tagline.
7. Add subtle animations: fade-in on scroll, hover effects on buttons, smooth scroll behavior.
8. Use semantic HTML5 elements (header, main, section, footer).
9. The page should look like a REAL professional business website, not a template.
10. Include a <title> and <meta description> appropriate for the business.`;

function buildUserPrompt(lead) {
  const phoneLine = lead.phone ? `Phone: ${lead.phone}` : 'Phone: Not available';
  return `Create a professional website for this business:

Business Name: ${lead.name}
Category/Industry: ${lead.category}
City/Location: ${lead.city}
Full Address: ${lead.address}
${phoneLine}

Design guidelines:
- Match the color scheme and tone to the "${lead.category}" industry
- The hero section should immediately communicate what this business does
- Write copy that sounds authentic to a local ${lead.category} business in ${lead.city}
- Make the CTA compelling and industry-appropriate
- The contact form should be clean and inviting`;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Generate a single-page HTML website for a lead using the OpenAI API.
 *
 * @param {object} lead - Lead object from leadFinder
 * @returns {Promise<{ html: string, filePath: string }>}
 */
export async function generateSite(lead) {
  requireConfig('OpenAI API');
  const client = getClient();

  console.log(`🎨 Generating website for: ${lead.name} (${lead.category})`);

  const response = await client.chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(lead) },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  });

  let html = response.choices[0].message.content.trim();

  // Clean up: remove markdown code fences if the model added them
  html = html.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '');

  // Ensure it starts with a doctype or html tag
  if (!html.toLowerCase().startsWith('<!doctype') && !html.toLowerCase().startsWith('<html')) {
    // Try to find the HTML content within the response
    const htmlMatch = html.match(/<!DOCTYPE html>[\s\S]*<\/html>/i) ||
                      html.match(/<html[\s\S]*<\/html>/i);
    if (htmlMatch) {
      html = htmlMatch[0];
    }
  }

  // Save to file
  await mkdir(config.generatedSitesDir, { recursive: true });
  const fileName = `${lead.slug}.html`;
  const filePath = path.join(config.generatedSitesDir, fileName);
  await writeFile(filePath, html, 'utf-8');

  console.log(`   ✅ Site saved: ${fileName} (${(html.length / 1024).toFixed(1)} KB)`);

  return { html, filePath, fileName };
}

export default { generateSite };
