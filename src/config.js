/**
 * Centralized configuration loader.
 * Reads from .env file and validates all required keys.
 */

import 'dotenv/config';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helper: read an env var with an optional default
// ---------------------------------------------------------------------------
function env(key, defaultValue = undefined) {
  const val = process.env[key];
  if (val !== undefined && val !== '') return val;
  if (defaultValue !== undefined) return defaultValue;
  return undefined;
}

// ---------------------------------------------------------------------------
// Build the config object
// ---------------------------------------------------------------------------
const config = Object.freeze({
  // Google Places
  googlePlacesApiKey: env('GOOGLE_PLACES_API_KEY'),

  // OpenAI
  openaiApiKey: env('OPENAI_API_KEY'),
  openaiModel: env('OPENAI_MODEL', 'gpt-4o'),

  // Vercel
  vercelToken: env('VERCEL_TOKEN'),
  vercelTeamId: env('VERCEL_TEAM_ID', ''),

  // Mailgun
  mailgunApiKey: env('MAILGUN_API_KEY'),
  mailgunDomain: env('MAILGUN_DOMAIN'),
  mailgunRegion: env('MAILGUN_REGION', 'us'),

  // Email
  senderEmail: env('SENDER_EMAIL', 'hello@yourdomain.com'),
  senderName: env('SENDER_NAME', 'Lead Gen Bot'),

  // Google Sheets
  googleSheetsId: env('GOOGLE_SHEETS_ID'),
  googleServiceAccountKeyFile: env(
    'GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
    path.join(PROJECT_ROOT, 'credentials', 'service-account.json')
  ),

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

// ---------------------------------------------------------------------------
// Validation: check which keys are present / missing
// ---------------------------------------------------------------------------
const REQUIRED_KEYS = {
  'Google Places API': 'googlePlacesApiKey',
  'OpenAI API':        'openaiApiKey',
  'Vercel Token':      'vercelToken',
  'Mailgun API':       'mailgunApiKey',
  'Mailgun Domain':    'mailgunDomain',
  'Google Sheets ID':  'googleSheetsId',
};

/**
 * Validate configuration and return a report.
 * @returns {{ valid: boolean, missing: string[], present: string[] }}
 */
export function validateConfig() {
  const missing = [];
  const present = [];

  for (const [label, key] of Object.entries(REQUIRED_KEYS)) {
    if (config[key]) {
      present.push(label);
    } else {
      missing.push(label);
    }
  }

  // Check service account file existence
  if (config.googleSheetsId && !existsSync(config.googleServiceAccountKeyFile)) {
    missing.push('Google Service Account Key File (not found at path)');
  }

  return { valid: missing.length === 0, missing, present };
}

/**
 * Validate config and throw if any required keys are missing.
 * @param {string[]} [requiredFor] - Subset of keys needed for a specific module
 */
export function requireConfig(...requiredFor) {
  const keysToCheck = requiredFor.length > 0
    ? requiredFor
    : Object.keys(REQUIRED_KEYS);

  const missingLabels = [];
  for (const label of keysToCheck) {
    const key = REQUIRED_KEYS[label];
    if (key && !config[key]) {
      missingLabels.push(label);
    }
  }

  if (missingLabels.length > 0) {
    throw new Error(
      `Missing required configuration:\n` +
      missingLabels.map(l => `  • ${l}`).join('\n') +
      `\n\nSet these in your .env file. See .env.example for reference.`
    );
  }
}

export default config;
