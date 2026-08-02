/**
 * Site Deployer Module
 * --------------------
 * Deploys generated HTML files to Vercel via the REST API.
 * Returns a live URL per deployment.
 *
 * Exports:
 *   deploySite(lead, htmlContent) → { url, deploymentId }
 */

import crypto from 'crypto';
import config, { requireConfig } from '../config.js';

const VERCEL_API_BASE = 'https://api.vercel.com';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHeaders() {
  return {
    Authorization: `Bearer ${config.vercelToken}`,
    'Content-Type': 'application/json',
  };
}

function getTeamQuery() {
  return config.vercelTeamId ? `?teamId=${config.vercelTeamId}` : '';
}

/**
 * Calculate SHA-1 hash of content (required by Vercel file upload API).
 */
function sha1(content) {
  return crypto.createHash('sha1').update(content).digest('hex');
}

/**
 * Retry wrapper with exponential backoff.
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;

      const isRateLimit = err.message?.includes('429') || err.message?.includes('rate');
      const delay = isRateLimit
        ? 5000 * attempt    // 5s, 10s, 15s for rate limits
        : 1000 * attempt;   // 1s, 2s, 3s for other errors

      console.log(`   ⏳ Retry ${attempt}/${maxRetries} in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ---------------------------------------------------------------------------
// Step 1: Upload file to Vercel
// ---------------------------------------------------------------------------

async function uploadFile(content) {
  const digest = sha1(content);

  const response = await fetch(`${VERCEL_API_BASE}/v2/files${getTeamQuery()}`, {
    method: 'POST',
    headers: {
      ...getHeaders(),
      'Content-Type': 'application/octet-stream',
      'x-vercel-digest': digest,
    },
    body: content,
  });

  // 200 = uploaded, 409 = already exists (both are fine)
  if (!response.ok && response.status !== 409) {
    const errorBody = await response.text();
    throw new Error(`Vercel file upload error (${response.status}): ${errorBody}`);
  }

  return { digest, size: Buffer.byteLength(content, 'utf-8') };
}

// ---------------------------------------------------------------------------
// Step 2: Create deployment
// ---------------------------------------------------------------------------

async function createDeployment(projectName, files) {
  const response = await fetch(`${VERCEL_API_BASE}/v13/deployments${getTeamQuery()}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      name: projectName,
      files: files,
      projectSettings: {
        framework: null,  // Static site — no framework
      },
      target: 'production',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Vercel deployment error (${response.status}): ${errorBody}`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Deploy an HTML file to Vercel for a given lead.
 *
 * @param {object} lead - Lead object (needs at minimum: slug, name)
 * @param {string} htmlContent - The HTML content to deploy
 * @returns {Promise<{ url: string, deploymentId: string, projectName: string }>}
 */
export async function deploySite(lead, htmlContent) {
  requireConfig('Vercel Token');

  if (config.dryRun) {
    const fakeUrl = `https://demo-${lead.slug}.vercel.app`;
    console.log(`   🏗️  [DRY RUN] Would deploy: ${fakeUrl}`);
    return { url: fakeUrl, deploymentId: 'dry-run', projectName: `demo-${lead.slug}` };
  }

  const projectName = `demo-${lead.slug}`;
  console.log(`🚀 Deploying site for: ${lead.name} → ${projectName}`);

  // Step 1: Upload the HTML file
  const { digest, size } = await withRetry(() => uploadFile(htmlContent));
  console.log(`   📤 File uploaded (SHA: ${digest.slice(0, 12)}...)`);

  // Step 2: Create the deployment
  const deployment = await withRetry(() =>
    createDeployment(projectName, [
      {
        file: 'index.html',
        sha: digest,
        size: size,
      },
    ])
  );

  const url = `https://${deployment.url}`;
  console.log(`   ✅ Deployed: ${url}`);

  return {
    url,
    deploymentId: deployment.id,
    projectName,
    readyState: deployment.readyState,
  };
}

export default { deploySite };
