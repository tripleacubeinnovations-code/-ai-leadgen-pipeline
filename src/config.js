/**
 * Centralized configuration loader for the 100% Free / Zero-Card Stack.
 * Reads from .env file and validates all required keys.
 */

import 'dotenv/config';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

function env(key, defaultValue = undefined) {
  const val = process.env[key];
  if (val !== undefined && val !== '') return val;
  if (defaultValue !== undefined) return defaultValue;
  return undefined;
}

const config = Object.freeze({
  // Gemini AI (Free from Google AI Studio)
  geminiApiKey: env('GEMINI_API_KEY'),
  geminiModel: env('GEMINI_MODEL', 'gemini-1.5-flash'),

  // Email (Resend API or Gmail SMTP)
  resendApiKey: env('RESEND_API_KEY'),
  gmailUser: env('GMAIL_USER'),
  gmailAppPassword: env('GMAIL_APP_PASSWORD'),
  senderEmail: env('SENDER_EMAIL', 'onboarding@resend.dev'),
  senderName: env('SENDER_NAME', 'Lead Gen Automation'),

  // Vercel
  vercelToken: env('VERCEL_TOKEN'),

  // Follow-up
  followUpDelayDays: parseInt(env('FOLLOW_UP_DELAY_DAYS', '3'), 10),
  followUpCron: env('FOLLOW_UP_CRON', '0 9 * * *'),

  // Pipeline
  concurrencyLimit: parseInt(env('CONCURRENCY_LIMIT', '3'), 10),
  dryRun: env('DRY_RUN', 'false') === 'true',

  // Paths
  generatedSitesDir: path.join(PROJECT_ROOT, 'generated-sites'),
  dataDir: path.join(PROJECT_ROOT, 'data'),
  projectRoot: PROJECT_ROOT,
});

const REQUIRED_KEYS = {
  'Gemini AI API Key': 'geminiApiKey',
  'Email Provider (Resend API Key or Gmail User)': (cfg) => !!(cfg.resendApiKey || (cfg.gmailUser && cfg.gmailAppPassword)),
  'Vercel Token': 'vercelToken',
};

export function validateConfig() {
  const missing = [];
  const present = [];

  if (config.geminiApiKey) present.push('Gemini AI API Key (Google AI Studio)');
  else missing.push('Gemini AI API Key (from https://aistudio.google.com/app/apikey)');

  if (config.resendApiKey) present.push('Email Provider: Resend API');
  else if (config.gmailUser && config.gmailAppPassword) present.push('Email Provider: Gmail SMTP');
  else missing.push('Email Provider (Resend API Key OR Gmail App Password)');

  if (config.vercelToken) present.push('Vercel Token');
  else missing.push('Vercel Token (from https://vercel.com/account/tokens)');

  return { valid: missing.length === 0, missing, present };
}

export function requireConfig(...requiredFor) {
  const { valid, missing } = validateConfig();
  if (!valid) {
    throw new Error(
      `Missing required configuration for Zero-Card Stack:\n` +
      missing.map(m => `  • ${m}`).join('\n') +
      `\n\nCopy .env.example to .env and paste your free keys.`
    );
  }
}

export default config;
