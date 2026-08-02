/**
 * Email Sender Module
 * -------------------
 * Sends emails via the Mailgun API using the official mailgun.js SDK.
 * Supports dry-run mode for testing.
 *
 * Exports:
 *   sendEmail(to, subject, htmlBody, textBody, options) → { status, messageId }
 */

import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import config, { requireConfig } from '../config.js';

let mgClient = null;

function getClient() {
  if (!mgClient) {
    requireConfig('Mailgun API', 'Mailgun Domain');
    const mailgun = new Mailgun(FormData);
    mgClient = mailgun.client({
      username: 'api',
      key: config.mailgunApiKey,
      url: config.mailgunRegion === 'eu'
        ? 'https://api.eu.mailgun.net'
        : 'https://api.mailgun.net',
    });
  }
  return mgClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap email body with a minimal HTML template and unsubscribe footer.
 */
function wrapHtmlBody(htmlBody, unsubscribeUrl) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    a { color: #2563eb; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  ${htmlBody}
  <div class="footer">
    <p>Sent by ${config.senderName} · <a href="${unsubscribeUrl || '#'}">Unsubscribe</a></p>
  </div>
</body>
</html>`;
}

/**
 * Add unsubscribe text to plain text body.
 */
function wrapTextBody(textBody) {
  return `${textBody}\n\n---\nSent by ${config.senderName} · Reply "unsubscribe" to opt out.`;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Send an email via Mailgun.
 *
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject line
 * @param {string} htmlBody - HTML email body (inner content, will be wrapped)
 * @param {string} textBody - Plain text fallback body
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - Override global dry-run setting
 * @param {string}  [options.replyTo] - Reply-to address
 * @param {object}  [options.tags] - Mailgun tags for tracking
 * @returns {Promise<{ status: string, messageId: string|null }>}
 */
export async function sendEmail(to, subject, htmlBody, textBody, options = {}) {
  const isDryRun = options.dryRun ?? config.dryRun;

  if (isDryRun) {
    console.log(`   📧 [DRY RUN] Would send email to: ${to}`);
    console.log(`   📧 Subject: "${subject}"`);
    console.log(`   📧 Body preview: ${textBody.slice(0, 120)}...`);
    return { status: 'dry-run', messageId: null };
  }

  requireConfig('Mailgun API', 'Mailgun Domain');
  const client = getClient();

  const fullHtml = wrapHtmlBody(htmlBody);
  const fullText = wrapTextBody(textBody);

  const messageData = {
    from: `${config.senderName} <${config.senderEmail}>`,
    to: [to],
    subject,
    text: fullText,
    html: fullHtml,
  };

  // Add optional reply-to
  if (options.replyTo) {
    messageData['h:Reply-To'] = options.replyTo;
  }

  // Add tags for tracking
  if (options.tags) {
    messageData['o:tag'] = Array.isArray(options.tags) ? options.tags : [options.tags];
  }

  try {
    const response = await client.messages.create(config.mailgunDomain, messageData);

    console.log(`   ✅ Email sent to ${to} — ID: ${response.id}`);
    return { status: 'sent', messageId: response.id };
  } catch (err) {
    console.error(`   ❌ Failed to send email to ${to}: ${err.message}`);
    return { status: 'failed', messageId: null, error: err.message };
  }
}

export default { sendEmail };
