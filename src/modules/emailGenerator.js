/**
 * Email Generator Module
 * ----------------------
 * Uses the OpenAI API to generate personalized cold emails and follow-ups,
 * referencing the business by name and linking to their demo site.
 *
 * Exports:
 *   generateEmail(lead, demoUrl, type) → { subject, textBody, htmlBody }
 */

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
// Prompt Templates
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert cold email copywriter for a professional web design agency. You write concise, genuine, high-converting cold emails.

STRICT RULES:
1. Output ONLY a JSON object with exactly these keys: "subject", "textBody", "htmlBody"
2. The email body must be 3-5 sentences. No more.
3. Sound human, warm, and professional — NOT salesy or spammy.
4. Reference the business by name naturally.
5. Include the demo site URL as a clickable link in the HTML body.
6. End with a soft CTA (question, not a command).
7. Do NOT include unsubscribe text — that will be added automatically.
8. The textBody should be plain text (no HTML tags). The htmlBody should be a simple, clean HTML email body (just the content, no full HTML document structure).
9. The subject line should be short (under 50 characters), personalized, and curiosity-provoking.`;

function buildInitialEmailPrompt(lead, demoUrl) {
  return `Write a cold outreach email to this business:

Business Name: ${lead.name}
Category: ${lead.category}
City: ${lead.city}

Demo Website URL: ${demoUrl}

Context: We noticed they don't have a website yet. We've built a free demo website for them to show what's possible. The email should:
- Open with something specific about their business or industry
- Mention we built a quick demo website for them
- Include the demo URL
- Ask if they'd like to chat about making it their official site`;
}

function buildFollowUpEmailPrompt(lead, demoUrl) {
  return `Write a SHORT follow-up email (2-3 sentences max) to this business:

Business Name: ${lead.name}
Category: ${lead.category}
City: ${lead.city}

Demo Website URL: ${demoUrl}

Context: We sent them an initial email 3 days ago with a free demo website we built for them. They haven't replied yet. This follow-up should:
- Be very brief and non-pushy
- Gently remind them about the demo site
- Include the URL again
- Ask a simple yes/no question`;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Generate a personalized email for a lead.
 *
 * @param {object} lead - Lead object
 * @param {string} demoUrl - The deployed demo site URL
 * @param {'initial'|'followup'} [type='initial'] - Email type
 * @returns {Promise<{ subject: string, textBody: string, htmlBody: string }>}
 */
export async function generateEmail(lead, demoUrl, type = 'initial') {
  requireConfig('OpenAI API');
  const client = getClient();

  const typeLabel = type === 'followup' ? 'follow-up' : 'initial';
  console.log(`✉️  Generating ${typeLabel} email for: ${lead.name}`);

  const userPrompt = type === 'followup'
    ? buildFollowUpEmailPrompt(lead, demoUrl)
    : buildInitialEmailPrompt(lead, demoUrl);

  const response = await client.chat.completions.create({
    model: config.openaiModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  });

  let content = response.choices[0].message.content.trim();

  // Parse the JSON response
  let emailData;
  try {
    emailData = JSON.parse(content);
  } catch {
    // Fallback: try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      emailData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error(`Failed to parse email response as JSON: ${content.slice(0, 200)}`);
    }
  }

  // Validate required fields
  const { subject, textBody, htmlBody } = emailData;
  if (!subject || !textBody || !htmlBody) {
    throw new Error(`Email response missing required fields. Got: ${Object.keys(emailData).join(', ')}`);
  }

  console.log(`   ✅ Email generated — Subject: "${subject}"`);

  return { subject, textBody, htmlBody };
}

export default { generateEmail };
