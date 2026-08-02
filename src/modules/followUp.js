/**
 * Follow-Up Module
 * ----------------
 * Manages retry/follow-up email sequences. Tracks lead state in a local
 * JSON file and sends follow-up emails to leads who haven't replied
 * after the configured delay period.
 *
 * Exports:
 *   trackLead(lead, demoUrl)          → void
 *   checkAndSendFollowUps()           → { sent: number, skipped: number }
 *   scheduleFollowUps()               → void (starts cron job)
 *   getLeadState(slug)                → LeadState | null
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import cron from 'node-cron';
import config from '../config.js';
import { generateEmail } from './emailGenerator.js';
import { sendEmail } from './emailSender.js';
import { updateLeadRow } from './logger.js';

const STATE_FILE = path.join(config.dataDir, 'leads-state.json');

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LeadState
 * @property {string} name
 * @property {string} slug
 * @property {string} category
 * @property {string} city
 * @property {string} email - Recipient email (if known)
 * @property {string} demoUrl
 * @property {string} initialSentAt - ISO timestamp
 * @property {string|null} followUpSentAt - ISO timestamp or null
 * @property {'sent'|'followed-up'|'replied'|'bounced'|'unsubscribed'} status
 */

/**
 * Load the current state file.
 * @returns {Promise<Record<string, LeadState>>}
 */
async function loadState() {
  await mkdir(config.dataDir, { recursive: true });

  if (!existsSync(STATE_FILE)) {
    return {};
  }

  const raw = await readFile(STATE_FILE, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Save the state file.
 * @param {Record<string, LeadState>} state
 */
async function saveState(state) {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Track a newly processed lead for follow-up.
 *
 * @param {object} lead - Lead object
 * @param {string} demoUrl - Deployed demo URL
 * @param {string} [recipientEmail] - The email we sent to (if known)
 */
export async function trackLead(lead, demoUrl, recipientEmail = '') {
  const state = await loadState();

  state[lead.slug] = {
    name: lead.name,
    slug: lead.slug,
    category: lead.category,
    city: lead.city,
    address: lead.address,
    phone: lead.phone,
    email: recipientEmail,
    demoUrl,
    initialSentAt: new Date().toISOString(),
    followUpSentAt: null,
    status: 'sent',
  };

  await saveState(state);
  console.log(`   📌 Tracking lead for follow-up: ${lead.name}`);
}

/**
 * Get the state of a specific lead.
 * @param {string} slug
 * @returns {Promise<LeadState|null>}
 */
export async function getLeadState(slug) {
  const state = await loadState();
  return state[slug] || null;
}

/**
 * Check for leads eligible for follow-up and send follow-up emails.
 *
 * Eligibility: initialSentAt > N days ago, followUpSentAt is null, status is 'sent'
 *
 * @returns {Promise<{ sent: number, skipped: number, errors: number }>}
 */
export async function checkAndSendFollowUps() {
  const state = await loadState();
  const entries = Object.entries(state);

  if (entries.length === 0) {
    console.log('\n📭 No leads being tracked. Nothing to follow up on.\n');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const now = new Date();
  const delayMs = config.followUpDelayDays * 24 * 60 * 60 * 1000;

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  console.log(`\n🔄 Checking ${entries.length} leads for follow-up (delay: ${config.followUpDelayDays} days)...\n`);

  for (const [slug, leadState] of entries) {
    // Skip leads that aren't eligible
    if (leadState.status !== 'sent') {
      skipped++;
      continue;
    }

    if (leadState.followUpSentAt) {
      skipped++;
      continue;
    }

    // Check if enough time has passed
    const sentDate = new Date(leadState.initialSentAt);
    const elapsed = now - sentDate;

    if (elapsed < delayMs) {
      const daysLeft = ((delayMs - elapsed) / (24 * 60 * 60 * 1000)).toFixed(1);
      console.log(`   ⏳ ${leadState.name}: ${daysLeft} days until follow-up`);
      skipped++;
      continue;
    }

    // This lead is eligible for follow-up
    console.log(`\n   📬 Following up with: ${leadState.name}`);

    try {
      // Generate follow-up email
      const emailContent = await generateEmail(
        {
          name: leadState.name,
          category: leadState.category,
          city: leadState.city,
          slug: leadState.slug,
        },
        leadState.demoUrl,
        'followup'
      );

      // Send follow-up (if we have an email address)
      if (leadState.email) {
        const result = await sendEmail(
          leadState.email,
          emailContent.subject,
          emailContent.htmlBody,
          emailContent.textBody,
          { tags: ['follow-up'] }
        );

        // Update state
        state[slug].followUpSentAt = new Date().toISOString();
        state[slug].status = 'followed-up';

        // Update Google Sheet
        try {
          await updateLeadRow(slug, {
            'Follow-Up Status': `followed-up (${new Date().toLocaleDateString()})`,
            'Notes': `Follow-up ${result.status}`,
          });
        } catch {
          // Non-critical — log locally anyway
        }

        sent++;
      } else {
        console.log(`   ⚠️  No email address for ${leadState.name} — skipping send`);
        console.log(`   📝 Follow-up content generated (subject: "${emailContent.subject}")`);
        skipped++;
      }
    } catch (err) {
      console.error(`   ❌ Error following up with ${leadState.name}: ${err.message}`);
      errors++;
    }
  }

  // Save updated state
  await saveState(state);

  console.log(`\n📊 Follow-up summary: ${sent} sent, ${skipped} skipped, ${errors} errors\n`);

  return { sent, skipped, errors };
}

/**
 * Start a cron job to automatically check and send follow-ups.
 */
export function scheduleFollowUps() {
  const cronExpr = config.followUpCron;

  if (!cron.validate(cronExpr)) {
    console.error(`❌ Invalid cron expression: ${cronExpr}`);
    return;
  }

  console.log(`⏰ Follow-up scheduler started (cron: ${cronExpr})`);
  console.log(`   Next run will check for leads needing follow-up.\n`);

  cron.schedule(cronExpr, async () => {
    console.log(`\n⏰ [${new Date().toISOString()}] Running scheduled follow-up check...`);
    try {
      await checkAndSendFollowUps();
    } catch (err) {
      console.error(`❌ Scheduled follow-up failed: ${err.message}`);
    }
  });
}

export default { trackLead, getLeadState, checkAndSendFollowUps, scheduleFollowUps };
