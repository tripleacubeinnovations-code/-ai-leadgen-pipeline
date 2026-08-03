/**
 * Web Dashboard Server
 * --------------------
 * Express-free native HTTP server serving the REST API and Dashboard UI.
 *
 * REST Endpoints:
 *   GET  /api/stats     — Analytics overview metrics
 *   GET  /api/leads     — All leads from data files
 *   POST /api/run       — Trigger pipeline run asynchronously
 *   POST /api/followup  — Trigger follow-up check
 *   GET  /api/sites     — List local HTML demo sites
 *   GET  /api/emails/:slug — Get saved email content for a lead
 *
 * Usage:
 *   node src/server.js [port]
 */

import http from 'http';
import { readFile, readdir, mkdir } from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import config from './config.js';
import { runFullPipeline } from './pipeline.js';
import { checkAndSendFollowUps } from './modules/followUp.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(config.projectRoot, 'src', 'dashboard');

// In-memory run log stream for UI log feed
let activeRunLog = [];
let isRunningPipeline = false;

// Override console.log during pipeline run to stream to dashboard
function captureLog(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
  activeRunLog.push(`[${new Date().toLocaleTimeString()}] ${line}`);
  if (activeRunLog.length > 200) activeRunLog.shift();
}

// ---------------------------------------------------------------------------
// Helper Data Readers
// ---------------------------------------------------------------------------

async function getStats() {
  const leadsFile = path.join(config.dataDir, 'leads.json');
  const resultsFile = path.join(config.dataDir, 'pipeline-results.json');
  const stateFile = path.join(config.dataDir, 'leads-state.json');

  let totalLeads = 0;
  let succeeded = 0;
  let deployedSites = 0;
  let emailsSent = 0;
  let followUpsPending = 0;
  let followedUpCount = 0;

  if (existsSync(leadsFile)) {
    try {
      const leads = JSON.parse(await readFile(leadsFile, 'utf-8'));
      totalLeads = leads.length;
    } catch {}
  }

  if (existsSync(resultsFile)) {
    try {
      const results = JSON.parse(await readFile(resultsFile, 'utf-8'));
      succeeded = results.filter(r => r.success).length;
      deployedSites = results.filter(r => r.demoUrl && r.demoUrl.startsWith('http')).length;
      emailsSent = results.filter(r => r.emailSent || r.emailStatus === 'sent' || r.emailStatus === 'dry-run').length;
    } catch {}
  }

  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf-8'));
      const entries = Object.values(state);
      followUpsPending = entries.filter(e => e.status === 'sent' && !e.followUpSentAt).length;
      followedUpCount = entries.filter(e => e.status === 'followed-up' || e.followUpSentAt).length;
      if (totalLeads === 0) totalLeads = entries.length;
    } catch {}
  }

  return {
    totalLeads,
    succeeded,
    deployedSites,
    emailsSent,
    followUpsPending,
    followedUpCount,
    isRunning: isRunningPipeline,
  };
}

async function getAllLeadsData() {
  const resultsFile = path.join(config.dataDir, 'pipeline-results.json');
  const stateFile = path.join(config.dataDir, 'leads-state.json');
  const leadsFile = path.join(config.dataDir, 'leads.json');

  let stateMap = {};
  if (existsSync(stateFile)) {
    try {
      stateMap = JSON.parse(await readFile(stateFile, 'utf-8'));
    } catch {}
  }

  let results = [];
  if (existsSync(resultsFile)) {
    try {
      results = JSON.parse(await readFile(resultsFile, 'utf-8'));
    } catch {}
  } else if (existsSync(leadsFile)) {
    try {
      const rawLeads = JSON.parse(await readFile(leadsFile, 'utf-8'));
      results = rawLeads.map(l => ({ lead: l, success: true, demoUrl: null }));
    } catch {}
  }

  // Merge results with state data
  return results.map(r => {
    const lead = r.lead || {};
    const slug = lead.slug || '';
    const state = stateMap[slug] || {};

    return {
      name: lead.name || state.name || 'Unknown',
      slug,
      category: lead.category || state.category || 'Business',
      city: lead.city || state.city || '',
      phone: lead.phone || state.phone || '',
      address: lead.address || state.address || '',
      demoUrl: r.demoUrl || state.demoUrl || null,
      emailStatus: r.emailStatus || (r.emailSent ? 'sent' : 'pending'),
      followUpStatus: state.status || (state.followUpSentAt ? 'followed-up' : 'pending'),
      initialSentAt: state.initialSentAt || null,
      followUpSentAt: state.followUpSentAt || null,
    };
  });
}

// ---------------------------------------------------------------------------
// Server Request Handler
// ---------------------------------------------------------------------------

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── REST API Endpoints ──────────────────────────────────────────

  if (pathname === '/api/stats' && req.method === 'GET') {
    const stats = await getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  if (pathname === '/api/leads' && req.method === 'GET') {
    const leads = await getAllLeadsData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(leads));
    return;
  }

  if (pathname === '/api/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: activeRunLog, isRunning: isRunningPipeline }));
    return;
  }

  if (pathname === '/api/run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const search = payload.search || 'plumber';
        const location = payload.location || 'Mumbai';
        const max = parseInt(payload.max || '5', 10);
        const recipient = payload.recipient || '';
        const dryRun = payload.dryRun === true;

        if (isRunningPipeline) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Pipeline is already running.' }));
          return;
        }

        isRunningPipeline = true;
        activeRunLog = [`Starting search for "${search}" in "${location}"...`];

        // Trigger run asynchronously
        runFullPipeline(search, location, {
          maxLeads: max,
          recipientEmail: recipient,
          dryRun,
        }).then(() => {
          isRunningPipeline = false;
          activeRunLog.push('✅ Pipeline run complete!');
        }).catch(err => {
          isRunningPipeline = false;
          activeRunLog.push(`❌ Pipeline run error: ${err.message}`);
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Pipeline launched successfully', search, location }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/followup' && req.method === 'POST') {
    try {
      const result = await checkAndSendFollowUps();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/leads/manual' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const name = payload.name;
        const category = payload.category || 'Business';
        const city = payload.city || 'Local Area';
        const address = payload.address || `${city}, Local Business Area`;
        const phone = payload.phone || '';
        const email = payload.email || '';
        const dryRun = payload.dryRun === true;

        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Business name is required' }));
          return;
        }

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

        const customLead = {
          id: `manual-${Date.now()}`,
          name,
          category,
          city,
          address,
          phone,
          email,
          slug,
          hasWebsite: false,
          websiteUri: null,
          mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(name + ' ' + city)}`,
        };

        const { processLead } = await import('./pipeline.js');
        const result = await processLead(customLead, {
          recipientEmail: email,
          dryRun,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
    const slug = pathname.replace('/api/emails/', '');
    const emailFile = path.join(config.dataDir, 'emails', `${slug}-email.json`);

    if (existsSync(emailFile)) {
      const content = await readFile(emailFile, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email content not found for slug' }));
    }
    return;
  }

  // ── Static Files (Dashboard UI) ─────────────────────────────────

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // If local generated sites preview requested
  if (pathname.startsWith('/generated-sites/')) {
    filePath = path.join(config.projectRoot, pathname);
  }

  if (existsSync(filePath)) {
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}

// ---------------------------------------------------------------------------
// Server Start
// ---------------------------------------------------------------------------

export function startServer(port = PORT) {
  const server = http.createServer(handleRequest);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Port ${port} is already in use. Trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error(`❌ Server error: ${err.message}`);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           📊  AI LEAD-GEN DASHBOARD RUNNING                ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n  👉 Server listening on port ${port}\n`);
  });

  return server;
}

if (process.argv[1]?.includes('server.js')) {
  startServer();
}

export default { startServer };
