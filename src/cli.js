#!/usr/bin/env node

/**
 * CLI Entry Point
 * ---------------
 * Command-line interface for the AI Lead-Gen Pipeline.
 * Each pipeline step can be run independently or as a full pipeline.
 *
 * Usage:
 *   node src/cli.js run --search "plumber" --location "Mumbai, India"
 *   node src/cli.js find-leads --search "dentist" --location "Austin, TX"
 *   node src/cli.js follow-up
 *   node src/cli.js check-config
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import config, { validateConfig } from './config.js';
import { runFullPipeline, processLead } from './pipeline.js';
import { findLeads } from './modules/leadFinder.js';
import { generateSite } from './modules/siteGenerator.js';
import { deploySite } from './modules/siteDeployer.js';
import { generateEmail } from './modules/emailGenerator.js';
import { sendEmail } from './modules/emailSender.js';
import { checkAndSendFollowUps, scheduleFollowUps } from './modules/followUp.js';

const program = new Command();

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function showBanner() {
  console.log(chalk.cyan.bold(`
  ╔═══════════════════════════════════════════════╗
  ║       🤖  AI Lead-Gen Pipeline  v1.0.0        ║
  ║       TripleACube Innovations                 ║
  ╚═══════════════════════════════════════════════╝
  `));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

program
  .name('leadgen')
  .description('AI-powered lead generation automation pipeline')
  .version('1.0.0');

// ── Full Pipeline ────────────────────────────────────────────────

program
  .command('run')
  .description('Run the full lead-gen pipeline (find → generate → deploy → email → log)')
  .requiredOption('-s, --search <term>', 'Business type to search for (e.g., "plumber")')
  .requiredOption('-l, --location <place>', 'Location to search in (e.g., "Mumbai, India")')
  .option('-m, --max <number>', 'Maximum leads to process', '10')
  .option('--dry-run', 'Preview everything without sending emails or deploying')
  .option('--skip-deploy', 'Skip Vercel deployment')
  .option('--skip-email', 'Skip email generation and sending')
  .option('--skip-log', 'Skip Google Sheets logging')
  .option('--follow-up', 'Start follow-up scheduler after pipeline completes')
  .option('--recipient <email>', 'Override recipient email for all leads (testing)')
  .action(async (opts) => {
    showBanner();

    if (opts.dryRun) {
      process.env.DRY_RUN = 'true';
      console.log(chalk.yellow('  ⚠️  DRY RUN MODE — No emails will be sent, no sites deployed.\n'));
    }

    try {
      const results = await runFullPipeline(opts.search, opts.location, {
        maxLeads: parseInt(opts.max, 10),
        skipDeploy: opts.skipDeploy,
        skipEmail: opts.skipEmail,
        skipLog: opts.skipLog,
        enableFollowUp: opts.followUp,
        recipientEmail: opts.recipient,
      });

      if (!opts.followUp) {
        process.exit(results.every(r => r.success) ? 0 : 1);
      }
      // If follow-up is enabled, keep the process running
    } catch (err) {
      console.error(chalk.red(`\n❌ Pipeline failed: ${err.message}\n`));
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    }
  });

// ── Find Leads ───────────────────────────────────────────────────

program
  .command('find-leads')
  .description('Search for businesses without websites')
  .requiredOption('-s, --search <term>', 'Business type to search for')
  .requiredOption('-l, --location <place>', 'Location to search in')
  .option('-m, --max <number>', 'Maximum results', '20')
  .option('--include-with-website', 'Include businesses that already have websites')
  .option('-o, --output <file>', 'Output file path', 'data/leads.json')
  .action(async (opts) => {
    showBanner();
    try {
      const leads = await findLeads(opts.search, opts.location, {
        maxResults: parseInt(opts.max, 10),
        includeWithWebsite: opts.includeWithWebsite,
      });

      // Save results
      const outputPath = path.resolve(config.projectRoot, opts.output);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(leads, null, 2), 'utf-8');

      console.log(chalk.green(`\n✅ ${leads.length} leads saved to: ${outputPath}\n`));

      // Print lead table
      if (leads.length > 0) {
        console.log(chalk.bold('  Leads Found:'));
        console.log('  ' + '─'.repeat(56));
        for (const lead of leads) {
          console.log(`  📍 ${chalk.bold(lead.name)}`);
          console.log(`     ${lead.category} · ${lead.city}`);
          console.log(`     ${lead.phone || 'No phone'}`);
          console.log('  ' + '─'.repeat(56));
        }
      }

      process.exit(0);
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err.message}\n`));
      process.exit(1);
    }
  });

// ── Generate Site ────────────────────────────────────────────────

program
  .command('generate-site')
  .description('Generate a demo website for a lead')
  .option('-f, --lead-file <path>', 'Path to leads JSON file', 'data/leads.json')
  .option('-i, --index <number>', 'Index of the lead to process (0-based)', '0')
  .option('--all', 'Generate sites for ALL leads in the file')
  .action(async (opts) => {
    showBanner();
    try {
      const filePath = path.resolve(config.projectRoot, opts.leadFile);
      if (!existsSync(filePath)) {
        throw new Error(`Leads file not found: ${filePath}\nRun 'find-leads' first.`);
      }

      const leads = JSON.parse(await readFile(filePath, 'utf-8'));

      if (opts.all) {
        console.log(`Generating sites for all ${leads.length} leads...\n`);
        for (let i = 0; i < leads.length; i++) {
          console.log(`\n[${i + 1}/${leads.length}]`);
          await generateSite(leads[i]);
        }
      } else {
        const index = parseInt(opts.index, 10);
        if (index < 0 || index >= leads.length) {
          throw new Error(`Invalid index ${index}. File has ${leads.length} leads (0-${leads.length - 1}).`);
        }
        await generateSite(leads[index]);
      }

      console.log(chalk.green(`\n✅ Sites generated in: ${config.generatedSitesDir}\n`));
      process.exit(0);
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err.message}\n`));
      process.exit(1);
    }
  });

// ── Deploy Sites ─────────────────────────────────────────────────

program
  .command('deploy-sites')
  .description('Deploy generated HTML files to Vercel')
  .option('-f, --lead-file <path>', 'Path to leads JSON file', 'data/leads.json')
  .option('-d, --dir <path>', 'Directory containing generated HTML files', 'generated-sites')
  .action(async (opts) => {
    showBanner();
    try {
      const leadsPath = path.resolve(config.projectRoot, opts.leadFile);
      const sitesDir = path.resolve(config.projectRoot, opts.dir);

      if (!existsSync(leadsPath)) {
        throw new Error(`Leads file not found: ${leadsPath}`);
      }

      const leads = JSON.parse(await readFile(leadsPath, 'utf-8'));
      const results = [];

      for (const lead of leads) {
        const htmlPath = path.join(sitesDir, `${lead.slug}.html`);
        if (!existsSync(htmlPath)) {
          console.log(chalk.yellow(`⚠️  No site file for ${lead.name} (${htmlPath})`));
          continue;
        }

        const html = await readFile(htmlPath, 'utf-8');
        const result = await deploySite(lead, html);
        results.push({ lead: lead.name, ...result });
      }

      // Save deployment results
      const resultsPath = path.join(config.dataDir, 'deployments.json');
      await mkdir(config.dataDir, { recursive: true });
      await writeFile(resultsPath, JSON.stringify(results, null, 2), 'utf-8');

      console.log(chalk.green(`\n✅ ${results.length} sites deployed. Results: ${resultsPath}\n`));
      process.exit(0);
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err.message}\n`));
      process.exit(1);
    }
  });

// ── Send Emails ──────────────────────────────────────────────────

program
  .command('send-emails')
  .description('Generate and send cold emails for leads with deployed sites')
  .option('-f, --results-file <path>', 'Path to pipeline results JSON', 'data/pipeline-results.json')
  .option('--dry-run', 'Preview emails without sending')
  .option('--recipient <email>', 'Override recipient email for testing')
  .action(async (opts) => {
    showBanner();
    if (opts.dryRun) process.env.DRY_RUN = 'true';

    try {
      const resultsPath = path.resolve(config.projectRoot, opts.resultsFile);
      if (!existsSync(resultsPath)) {
        throw new Error(`Results file not found: ${resultsPath}\nRun the full pipeline or deploy-sites first.`);
      }

      const results = JSON.parse(await readFile(resultsPath, 'utf-8'));
      const leadsWithUrls = results.filter(r => r.demoUrl);

      console.log(`Generating and sending emails for ${leadsWithUrls.length} leads...\n`);

      for (const result of leadsWithUrls) {
        const lead = result.lead;
        const emailContent = await generateEmail(lead, result.demoUrl, 'initial');
        const to = opts.recipient || lead.email;

        if (to) {
          await sendEmail(to, emailContent.subject, emailContent.htmlBody, emailContent.textBody);
        } else {
          console.log(chalk.yellow(`⚠️  No email for ${lead.name} — saving content to file`));
        }
      }

      console.log(chalk.green(`\n✅ Email processing complete.\n`));
      process.exit(0);
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err.message}\n`));
      process.exit(1);
    }
  });

// ── Follow-Up ────────────────────────────────────────────────────

program
  .command('follow-up')
  .description('Check and send follow-up emails for leads past the delay period')
  .option('--schedule', 'Start the automated follow-up scheduler (keeps process running)')
  .option('--dry-run', 'Preview which leads would get follow-ups')
  .action(async (opts) => {
    showBanner();
    if (opts.dryRun) process.env.DRY_RUN = 'true';

    try {
      if (opts.schedule) {
        console.log('Starting follow-up scheduler...\n');
        scheduleFollowUps();
        // Keep process running
      } else {
        const result = await checkAndSendFollowUps();
        console.log(chalk.green(`\n✅ Follow-up check complete.`));
        console.log(`   Sent: ${result.sent} | Skipped: ${result.skipped} | Errors: ${result.errors}\n`);
        process.exit(0);
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ Error: ${err.message}\n`));
      process.exit(1);
    }
  });

// ── Check Config ─────────────────────────────────────────────────

program
  .command('check-config')
  .description('Validate that all required API keys and configuration are set')
  .action(() => {
    showBanner();
    const { valid, missing, present } = validateConfig();

    console.log(chalk.bold('  Configuration Status:\n'));

    for (const key of present) {
      console.log(chalk.green(`  ✅ ${key}`));
    }
    for (const key of missing) {
      console.log(chalk.red(`  ❌ ${key} — NOT SET`));
    }

    console.log('');

    if (valid) {
      console.log(chalk.green.bold('  ✅ All required configuration is set!\n'));
    } else {
      console.log(chalk.yellow.bold(`  ⚠️  ${missing.length} required key(s) missing.`));
      console.log(chalk.dim('  Copy .env.example to .env and fill in the missing values.\n'));
    }

    // Show current settings
    console.log(chalk.bold('  Current Settings:'));
    console.log(`  • OpenAI Model:     ${config.openaiModel}`);
    console.log(`  • Mailgun Region:   ${config.mailgunRegion}`);
    console.log(`  • Follow-up Delay:  ${config.followUpDelayDays} days`);
    console.log(`  • Concurrency:      ${config.concurrencyLimit}`);
    console.log(`  • Dry Run:          ${config.dryRun}`);
    console.log(`  • Sites Dir:        ${config.generatedSitesDir}`);
    console.log(`  • Data Dir:         ${config.dataDir}`);
    console.log('');

    process.exit(valid ? 0 : 1);
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  showBanner();
  program.outputHelp();
}
