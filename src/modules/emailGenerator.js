/**
 * Email Generator Module (100% FREE - Google Gemini API)
 * -----------------------------------------------------
 * Uses Google Gemini API to generate personalized cold emails and follow-ups.
 *
 * REQUIRES NO CREDIT CARD! Free from https://aistudio.google.com/app/apikey
 *
 * Exports:
 *   generateEmail(lead, demoUrl, type) → { subject, textBody, htmlBody }
 */

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

const SYSTEM_PROMPT = `You are a warm, genuine cold email copywriter. Write a 3-5 sentence personalized outreach email.

STRICT JSON OUTPUT REQUIREMENT:
Return ONLY a valid raw JSON object with keys: "subject", "textBody", "htmlBody".
Do NOT wrap in markdown \`\`\`json fences.

Rules:
1. Warm, professional, human tone (not salesy).
2. Reference the business name and their city naturally.
3. Mention you noticed they don't have a website listed on Google, so you built a free live demo site for them.
4. Include the demo URL naturally in the body.
5. End with a soft question CTA.`;

function buildPrompt(lead, demoUrl, type) {
  if (type === 'followup') {
    return `Write a SHORT 2-sentence follow-up email to ${lead.name} (${lead.category} in ${lead.city}). Remind them about the free demo site built for them at ${demoUrl}. Ask a simple yes/no question if they saw it.`;
  }
  return `Write a cold email to ${lead.name} (${lead.category} in ${lead.city}). Demo site URL: ${demoUrl}`;
}

/**
 * Generate personalized email using Gemini API.
 *
 * @param {object} lead
 * @param {string} demoUrl
 * @param {'initial'|'followup'} [type='initial']
 * @returns {Promise<{ subject: string, textBody: string, htmlBody: string }>}
 */
export async function generateEmail(lead, demoUrl, type = 'initial') {
  const model = getGeminiModel();

  console.log(`✉️  Generating ${type} email via Gemini AI for: ${lead.name}`);

  const prompt = `${SYSTEM_PROMPT}\n\n${buildPrompt(lead, demoUrl, type)}`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  let text = response.text().trim();

  // Strip markdown code fences if present
  text = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();

  let emailData;
  try {
    emailData = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      emailData = JSON.parse(jsonMatch[0]);
    } else {
      // Fallback object if raw text returned
      emailData = {
        subject: `Free Demo Website for ${lead.name}`,
        textBody: `Hi ${lead.name},\n\nWe built a free demo website for your business in ${lead.city}: ${demoUrl}\n\nWould you like to take a look?`,
        htmlBody: `<p>Hi ${lead.name},</p><p>We built a free demo website for your business in ${lead.city}: <a href="${demoUrl}">${demoUrl}</a></p><p>Would you like to take a look?</p>`,
      };
    }
  }

  console.log(`   ✅ Email generated — Subject: "${emailData.subject}"`);

  return emailData;
}

export default { generateEmail };
