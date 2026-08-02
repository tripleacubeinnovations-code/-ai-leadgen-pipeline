/**
 * Logger Module
 * -------------
 * Logs lead data, demo URLs, and email statuses to a Google Sheet
 * using the Google Sheets API v4 with service account authentication.
 *
 * Exports:
 *   initSheet()                        → void (creates headers if needed)
 *   logLead(lead, demoUrl, emailStatus) → void
 *   updateLeadRow(leadName, updates)    → void
 *   getAllRows()                        → string[][]
 */

import { google } from 'googleapis';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import config, { requireConfig } from '../config.js';

const SHEET_NAME = 'Leads';
const HEADERS = [
  'Timestamp',
  'Business Name',
  'Category',
  'City',
  'Address',
  'Phone',
  'Google Maps URL',
  'Demo Site URL',
  'Email Status',
  'Follow-Up Status',
  'Lead Slug',
  'Notes',
];

let sheetsClient = null;

// ---------------------------------------------------------------------------
// Auth & Client
// ---------------------------------------------------------------------------

async function getClient() {
  if (sheetsClient) return sheetsClient;

  requireConfig('Google Sheets ID');

  const keyFilePath = config.googleServiceAccountKeyFile;
  if (!existsSync(keyFilePath)) {
    throw new Error(
      `Google service account key file not found at: ${keyFilePath}\n` +
      `Download it from Google Cloud Console and place it there.`
    );
  }

  const keyFileContent = JSON.parse(await readFile(keyFilePath, 'utf-8'));

  const auth = new google.auth.GoogleAuth({
    credentials: keyFileContent,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Initialize the sheet with headers if they don't exist yet.
 */
export async function initSheet() {
  const sheets = await getClient();

  try {
    // Check if headers already exist
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheetsId,
      range: `${SHEET_NAME}!A1:L1`,
    });

    if (!res.data.values || res.data.values.length === 0) {
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.googleSheetsId,
        range: `${SHEET_NAME}!A1:L1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [HEADERS],
        },
      });
      console.log('📋 Sheet initialized with headers');
    }
  } catch (err) {
    // If the sheet doesn't exist, the API will throw. Try to handle gracefully.
    if (err.message?.includes('Unable to parse range')) {
      // Try creating with Sheet1 as fallback
      console.warn(`⚠️  Sheet "${SHEET_NAME}" not found. Trying "Sheet1" instead...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.googleSheetsId,
        range: `Sheet1!A1:L1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [HEADERS],
        },
      });
      console.log('📋 Sheet initialized with headers (using Sheet1)');
    } else {
      throw err;
    }
  }
}

/**
 * Log a lead and its pipeline results to the Google Sheet.
 *
 * @param {object} lead - Lead object
 * @param {string} demoUrl - Deployed demo site URL
 * @param {object} emailResult - { status, messageId }
 * @param {string} [notes] - Additional notes
 */
export async function logLead(lead, demoUrl, emailResult, notes = '') {
  if (config.dryRun) {
    console.log(`   📋 [DRY RUN] Would log to sheet: ${lead.name} | ${demoUrl} | ${emailResult.status}`);
    return;
  }

  const sheets = await getClient();

  const row = [
    timestamp(),
    lead.name,
    lead.category,
    lead.city,
    lead.address,
    lead.phone,
    lead.mapsUrl,
    demoUrl,
    emailResult.status,
    'pending',           // Follow-up status
    lead.slug,
    notes,
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.googleSheetsId,
      range: `${SHEET_NAME}!A:L`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row],
      },
    });
    console.log(`   📋 Logged to Google Sheet: ${lead.name}`);
  } catch (err) {
    // Fallback to Sheet1
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.googleSheetsId,
        range: `Sheet1!A:L`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [row],
        },
      });
      console.log(`   📋 Logged to Google Sheet (Sheet1): ${lead.name}`);
    } catch (fallbackErr) {
      console.error(`   ❌ Failed to log to Google Sheet: ${fallbackErr.message}`);
    }
  }
}

/**
 * Update a specific lead's row by searching for the lead slug.
 *
 * @param {string} leadSlug - The slug identifier for the lead
 * @param {object} updates - Key-value pairs to update (column header → new value)
 */
export async function updateLeadRow(leadSlug, updates) {
  if (config.dryRun) {
    console.log(`   📋 [DRY RUN] Would update sheet row for: ${leadSlug}`);
    return;
  }

  const sheets = await getClient();

  // Get all data to find the row
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetsId,
    range: `${SHEET_NAME}!A:L`,
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return; // No data rows

  const headers = rows[0];
  const slugColIndex = headers.indexOf('Lead Slug');

  // Find the row with the matching slug
  let targetRowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][slugColIndex] === leadSlug) {
      targetRowIndex = i;
      break;
    }
  }

  if (targetRowIndex === -1) {
    console.warn(`   ⚠️  Lead row not found for slug: ${leadSlug}`);
    return;
  }

  // Apply updates
  const updatedRow = [...rows[targetRowIndex]];
  for (const [header, value] of Object.entries(updates)) {
    const colIndex = headers.indexOf(header);
    if (colIndex !== -1) {
      updatedRow[colIndex] = value;
    }
  }

  // Write back the updated row (1-indexed for sheets, +1 for header)
  const rowNumber = targetRowIndex + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheetsId,
    range: `${SHEET_NAME}!A${rowNumber}:L${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [updatedRow],
    },
  });

  console.log(`   📋 Updated sheet row ${rowNumber} for: ${leadSlug}`);
}

/**
 * Get all rows from the sheet (for follow-up scanning).
 * @returns {Promise<string[][]>}
 */
export async function getAllRows() {
  const sheets = await getClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetsId,
    range: `${SHEET_NAME}!A:L`,
  });

  return res.data.values || [];
}

// ---------------------------------------------------------------------------
// Local file-based logging (fallback / always-on)
// ---------------------------------------------------------------------------

/**
 * Also log to a local JSON file for resilience.
 */
export async function logToLocalFile(lead, demoUrl, emailResult) {
  const localLogPath = path.join(config.dataDir, 'pipeline-log.json');

  await mkdir(config.dataDir, { recursive: true });

  let existing = [];
  if (existsSync(localLogPath)) {
    const raw = await readFile(localLogPath, 'utf-8');
    existing = JSON.parse(raw);
  }

  existing.push({
    timestamp: timestamp(),
    lead: {
      name: lead.name,
      slug: lead.slug,
      category: lead.category,
      city: lead.city,
      phone: lead.phone,
      address: lead.address,
    },
    demoUrl,
    emailStatus: emailResult.status,
    emailMessageId: emailResult.messageId,
    followUpStatus: 'pending',
  });

  await writeFile(localLogPath, JSON.stringify(existing, null, 2), 'utf-8');
}

export default { initSheet, logLead, updateLeadRow, getAllRows, logToLocalFile };
