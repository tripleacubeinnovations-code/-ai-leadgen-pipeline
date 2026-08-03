/**
 * Email Sender Module (100% FREE - Resend API or Gmail SMTP)
 * ---------------------------------------------------------
 * Sends emails using Resend (100% free, 3,000 emails/mo, NO credit card)
 * OR Nodemailer Gmail SMTP (100% free, 500 emails/day, NO credit card).
 *
 * Exports:
 *   sendEmail(to, subject, htmlBody, textBody, options) → { status, messageId }
 */

import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import config from '../config.js';

let resendClient = null;
let nodemailerTransporter = null;

function getResendClient() {
  if (!resendClient && config.resendApiKey) {
    resendClient = new Resend(config.resendApiKey);
  }
  return resendClient;
}

function getNodemailerTransporter() {
  if (!nodemailerTransporter && config.gmailUser && config.gmailAppPassword) {
    nodemailerTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.gmailUser,
        pass: config.gmailAppPassword,
      },
    });
  }
  return nodemailerTransporter;
}

function wrapHtmlBody(htmlBody) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    a { color: #2563eb; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  ${htmlBody}
  <div class="footer">
    <p>Sent by ${config.senderName} · Reply "unsubscribe" to opt out.</p>
  </div>
</body>
</html>`;
}

/**
 * Send email via Resend or Gmail SMTP.
 *
 * @param {string} to
 * @param {string} subject
 * @param {string} htmlBody
 * @param {string} textBody
 * @param {object} [options]
 * @returns {Promise<{ status: string, messageId: string|null }>}
 */
export async function sendEmail(to, subject, htmlBody, textBody, options = {}) {
  const isDryRun = options.dryRun ?? config.dryRun;

  if (isDryRun) {
    console.log(`   📧 [DRY RUN] Would send email to: ${to}`);
    console.log(`   📧 Subject: "${subject}"`);
    console.log(`   📧 Body preview: ${textBody.slice(0, 100)}...`);
    return { status: 'dry-run', messageId: null };
  }

  const fullHtml = wrapHtmlBody(htmlBody);

  // Method 1: Try Resend API (Free, No Card)
  const resend = getResendClient();
  if (resend) {
    try {
      const data = await resend.emails.send({
        from: `${config.senderName} <${config.senderEmail}>`,
        to: [to],
        subject,
        html: fullHtml,
        text: textBody,
      });

      if (data.error) {
        throw new Error(data.error.message);
      }

      console.log(`   ✅ Email sent via Resend to ${to} — ID: ${data.data?.id}`);
      return { status: 'sent', messageId: data.data?.id };
    } catch (err) {
      console.warn(`   ⚠️ Resend API warning: ${err.message}. Trying Gmail SMTP...`);
    }
  }

  // Method 2: Try Gmail SMTP (Free, No Card)
  const transporter = getNodemailerTransporter();
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"${config.senderName}" <${config.gmailUser}>`,
        to,
        subject,
        html: fullHtml,
        text: textBody,
      });

      console.log(`   ✅ Email sent via Gmail SMTP to ${to} — ID: ${info.messageId}`);
      return { status: 'sent', messageId: info.messageId };
    } catch (err) {
      console.error(`   ❌ Gmail SMTP failed: ${err.message}`);
      return { status: 'failed', messageId: null, error: err.message };
    }
  }

  console.log(`   ⚠️ No email keys configured in .env — email logged to console only.`);
  return { status: 'no-provider', messageId: null };
}

export default { sendEmail };
