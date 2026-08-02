/**
 * Pipeline Orchestrator
 * ---------------------
 * Runs the full lead-gen pipeline or individual steps.
 * Handles concurrency, progress reporting, and error recovery.
 *
 * Exports:
 *   runFullPipeline(searchTerm, location, options) → PipelineResult[]
 *   processLead(lead, options)                     → LeadResult
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import config from './config.js';
import { findLeads } from './modules/leadFinder.js';
import { generateSite } from './modules/siteGenerator.js';
import { deploySite } from './modules/siteDeployer.js';
import { generateEmail } from './modules/emailGenerator.js';
import { sendEmail } from './modules/emailSender.js';
import { initSheet, logLead, logToLocalFile } from './modules/logger.js';
import { trackLead, scheduleFollowUps } from './modules/followUp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run async tasks with concurrency control.
 */
async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const promise = task().then(result => {
      executing.delete(promise);
      return result;
    });
    executing.add(promise);
    results.push(promise);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

function divider(title) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
}

// ---------------------------------------------------------------------------
// Process a single lead through the full pipeline
// ---------------------------------------------------------------------------

/**
 * Process a single lead: generate site → deploy → generate email → send → log
 *
 * @param {object} lead - Lead object from leadFinder
 * @param {object} options
 * @param {string} [options.recipientEmail] - Override recipient email
 * @param {boolean} [options.skipDeploy] - Skip Vercel deployment
 * @param {boolean} [options.skipEmail] - Skip email generation and sending
 * @param {boolean} [options.skipLog] - Skip Google Sheets logging
 * @returns {Promise<object>} Result object for this lead
 */
export async function processLead(lead, options = {}) {
  const result = {
    lead,
    success: false,
    siteGenerated: false,
    siteDeployed: false,
    emailGenerated: false,
    emailSent: false,
    logged: false,
    demoUrl: null,
    error: null,
  };

  try {
    // Step 1: Generate demo website
    divider(`🎨 STEP 1: Generating site for ${lead.name}`);
    const { html, filePath } = await generateSite(lead);
    result.siteGenerated = true;
    result.siteFilePath = filePath;

    // Step 2: Deploy to Vercel
    if (!options.skipDeploy) {
      divider(`🚀 STEP 2: Deploying site for ${lead.name}`);
      const deployment = await deploySite(lead, html);
      result.siteDeployed = true;
      result.demoUrl = deployment.url;
    } else {
      result.demoUrl = `file://${filePath}`;
      console.log(`   ⏭️  Skipping deployment (--skip-deploy)`);
    }

    // Step 3: Generate email
    let emailContent = null;
    if (!options.skipEmail) {
      divider(`✉️  STEP 3: Generating email for ${lead.name}`);
      emailContent = await generateEmail(lead, result.demoUrl, 'initial');
      result.emailGenerated = true;
      result.emailSubject = emailContent.subject;
    } else {
      console.log(`   ⏭️  Skipping email generation (--skip-email)`);
    }

    // Step 4: Send email
    if (!options.skipEmail && emailContent) {
      divider(`📤 STEP 4: Sending email for ${lead.name}`);
      const recipientEmail = options.recipientEmail || lead.email;

      if (recipientEmail) {
        const sendResult = await sendEmail(
          recipientEmail,
          emailContent.subject,
          emailContent.htmlBody,
          emailContent.textBody,
          { tags: ['initial-outreach', lead.category] }
        );
        result.emailSent = true;
        result.emailStatus = sendResult.status;
        result.emailMessageId = sendResult.messageId;
      } else {
        console.log(`   ⚠️  No recipient email for ${lead.name}`);
        console.log(`   📝 Email content saved but not sent.`);
        result.emailStatus = 'no-recipient';

        // Save the generated email content for manual sending
        const emailFile = path.join(config.dataDir, 'emails', `${lead.slug}-email.json`);
        await mkdir(path.dirname(emailFile), { recursive: true });
        await writeFile(emailFile, JSON.stringify(emailContent, null, 2), 'utf-8');
        console.log(`   💾 Email saved to: ${emailFile}`);
      }
    }

    // Step 5: Log results
    if (!options.skipLog) {
      divider(`📋 STEP 5: Logging results for ${lead.name}`);
      try {
        await logLead(lead, result.demoUrl, {
          status: result.emailStatus || 'not-sent',
          messageId: result.emailMessageId || null,
        });
        result.logged = true;
      } catch (err) {
        console.warn(`   ⚠️  Google Sheets logging failed: ${err.message}`);
        console.log(`   📝 Falling back to local log...`);
      }

      // Always log locally as well
      await logToLocalFile(lead, result.demoUrl, {
        status: result.emailStatus || 'not-sent',
        messageId: result.emailMessageId || null,
      });
    }

    // Step 6: Track for follow-up
    if (!options.skipEmail) {
      await trackLead(lead, result.demoUrl, options.recipientEmail || lead.email || '');
    }

    result.success = true;

  } catch (err) {
    result.error = err.message;
    console.error(`\n❌ Error processing ${lead.name}: ${err.message}\n`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Full Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the complete lead-gen pipeline.
 *
 * @param {string} searchTerm - Business type to search for
 * @param {string} location - Location to search in
 * @param {object} [options]
 * @param {number}  [options.maxLeads=10]    - Max leads to process
 * @param {boolean} [options.skipDeploy]     - Skip Vercel deployment
 * @param {boolean} [options.skipEmail]      - Skip email steps
 * @param {boolean} [options.skipLog]        - Skip logging
 * @param {boolean} [options.enableFollowUp] - Start follow-up scheduler
 * @param {string}  [options.recipientEmail] - Override all recipient emails
 * @returns {Promise<object[]>} Array of results per lead
 */
export async function runFullPipeline(searchTerm, location, options = {}) {
  const { maxLeads = 10, enableFollowUp = false } = options;

  const startTime = Date.now();

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           🚀  AI LEAD-GEN PIPELINE — STARTING              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  Search:   "${searchTerm}"`);
  console.log(`  Location: "${location}"`);
  console.log(`  Max leads: ${maxLeads}`);
  console.log(`  Dry run:   ${config.dryRun}`);
  console.log(`  Follow-up: ${enableFollowUp}\n`);

  // Initialize Google Sheet (non-critical)
  if (!options.skipLog) {
    try {
      await initSheet();
    } catch (err) {
      console.warn(`⚠️  Could not initialize Google Sheet: ${err.message}`);
      console.log(`   Continuing without sheet logging...\n`);
    }
  }

  // ── PHASE 1: Find Leads ──────────────────────────────────────────
  divider('📍 PHASE 1: FINDING LEADS');
  const leads = await findLeads(searchTerm, location, { maxResults: maxLeads });

  if (leads.length === 0) {
    console.log('⚠️  No leads found without websites. Try a different search or location.');
    return [];
  }

  // Save raw leads to file
  await mkdir(config.dataDir, { recursive: true });
  const leadsFile = path.join(config.dataDir, 'leads.json');
  await writeFile(leadsFile, JSON.stringify(leads, null, 2), 'utf-8');
  console.log(`💾 Leads saved to: ${leadsFile}`);

  // ── PHASE 2: Process Each Lead ───────────────────────────────────
  divider('⚙️  PHASE 2: PROCESSING LEADS');
  console.log(`Processing ${leads.length} leads (concurrency: ${config.concurrencyLimit})...\n`);

  const tasks = leads.map((lead, index) => () => {
    console.log(`\n${'▓'.repeat(60)}`);
    console.log(`  LEAD ${index + 1}/${leads.length}: ${lead.name}`);
    console.log(`${'▓'.repeat(60)}`);
    return processLead(lead, options);
  });

  // Process leads with concurrency control
  const settledResults = await runWithConcurrency(tasks, config.concurrencyLimit);
  const results = settledResults.map(r =>
    r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message }
  );

  // Save pipeline results
  const resultsFile = path.join(config.dataDir, 'pipeline-results.json');
  await writeFile(resultsFile, JSON.stringify(results, null, 2), 'utf-8');

  // ── SUMMARY ──────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           📊  PIPELINE COMPLETE — SUMMARY                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  Total leads:  ${leads.length}`);
  console.log(`  ✅ Succeeded: ${succeeded}`);
  console.log(`  ❌ Failed:    ${failed}`);
  console.log(`  ⏱️  Time:     ${elapsed}s`);
  console.log(`\n  Results: ${resultsFile}`);
  console.log(`  Leads:   ${leadsFile}\n`);

  // Print individual results
  for (const r of results) {
    if (r.success) {
      console.log(`  ✅ ${r.lead?.name || 'Unknown'} → ${r.demoUrl || 'no URL'}`);
    } else {
      console.log(`  ❌ ${r.lead?.name || 'Unknown'} → Error: ${r.error}`);
    }
  }
  console.log('');

  // ── PHASE 3: Start Follow-Up Scheduler (Optional) ───────────────
  if (enableFollowUp) {
    divider('⏰ PHASE 3: STARTING FOLLOW-UP SCHEDULER');
    scheduleFollowUps();
    console.log('Pipeline will keep running to check for follow-ups.');
    console.log('Press Ctrl+C to stop.\n');
  }

  return results;
}

export default { runFullPipeline, processLead };
