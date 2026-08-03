/**
 * AI Lead-Gen Dashboard Client Script
 * -----------------------------------
 * Fetches metrics, updates lead database tables, manages modal popups,
 * and streams pipeline execution logs in real-time.
 */

let leadsData = [];
let logPollInterval = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  fetchStats();
  fetchLeads();
  setupEventListeners();

  // Poll for status updates every 5 seconds
  setInterval(fetchStats, 5000);
});

// ---------------------------------------------------------------------------
// API Calls
// ---------------------------------------------------------------------------

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const stats = await res.json();

    document.getElementById('statTotalLeads').textContent = stats.totalLeads || 0;
    document.getElementById('statDeployedSites').textContent = stats.deployedSites || 0;
    document.getElementById('statEmailsSent').textContent = stats.emailsSent || 0;
    document.getElementById('statPendingFollowups').textContent = stats.followUpsPending || 0;

    if (stats.isRunning && !logPollInterval) {
      startLogPolling();
    }
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}

async function fetchLeads() {
  try {
    const res = await fetch('/api/leads');
    if (!res.ok) return;
    leadsData = await res.json();
    renderLeadsTable(leadsData);
  } catch (err) {
    console.error('Failed to fetch leads:', err);
  }
}

// ---------------------------------------------------------------------------
// UI Rendering
// ---------------------------------------------------------------------------

function renderLeadsTable(leads) {
  const tbody = document.getElementById('leadsTableBody');

  if (!leads || leads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: #94a3b8;">
          No leads processed yet. Click <strong>"🚀 Run Pipeline"</strong> to start finding businesses!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = leads.map(lead => {
    const emailBadge = getStatusBadge(lead.emailStatus);
    const followUpBadge = getStatusBadge(lead.followUpStatus);

    const demoLink = lead.demoUrl
      ? `<a href="${lead.demoUrl}" target="_blank" class="link-action">🔗 Open Site</a> 
         · <span class="link-action" onclick="previewSite('${lead.demoUrl}', '${escapeQuotes(lead.name)}')">👁️ Preview</span>`
      : `<span style="color: #94a3b8;">Not deployed</span>`;

    return `
      <tr>
        <td><strong>${escapeHtml(lead.name)}</strong></td>
        <td>${escapeHtml(lead.category)}</td>
        <td>${escapeHtml(lead.city)}</td>
        <td>${escapeHtml(lead.phone || 'N/A')}</td>
        <td>${demoLink}</td>
        <td>${emailBadge}</td>
        <td>${followUpBadge}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="viewEmail('${lead.slug}', '${escapeQuotes(lead.name)}')">✉️ Email Content</button>
        </td>
      </tr>
    `;
  }).join('');
}

function getStatusBadge(status) {
  if (!status) return '<span class="badge badge-pending">pending</span>';
  const s = status.toLowerCase();

  if (s.includes('sent') || s.includes('followed-up')) {
    return `<span class="badge badge-sent">${status}</span>`;
  }
  if (s.includes('failed') || s.includes('error')) {
    return `<span class="badge badge-failed">${status}</span>`;
  }
  return `<span class="badge badge-pending">${status}</span>`;
}

// ---------------------------------------------------------------------------
// Pipeline Launcher & Live Log Polling
// ---------------------------------------------------------------------------

function startLogPolling() {
  const logBox = document.getElementById('logBox');
  const runCard = document.getElementById('runCard');
  logBox.style.display = 'block';
  runCard.style.display = 'block';

  if (logPollInterval) clearInterval(logPollInterval);

  logPollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/logs');
      if (!res.ok) return;
      const data = await res.json();

      const term = document.getElementById('terminalLog');
      term.textContent = (data.logs || []).join('\n');
      term.scrollTop = term.scrollHeight;

      if (!data.isRunning) {
        clearInterval(logPollInterval);
        logPollInterval = null;
        document.getElementById('logSpinner').style.display = 'none';
        fetchStats();
        fetchLeads();
      }
    } catch {}
  }, 1500);
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

function setupEventListeners() {
  // Launch run card toggle
  document.getElementById('btnLaunchRun').addEventListener('click', () => {
    const card = document.getElementById('runCard');
    card.style.display = card.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('btnCloseRunCard').addEventListener('click', () => {
    document.getElementById('runCard').style.display = 'none';
  });

  document.getElementById('btnRefresh').addEventListener('click', () => {
    fetchStats();
    fetchLeads();
  });

  // Search filter input
  document.getElementById('searchFilter').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = leadsData.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.city.toLowerCase().includes(q) ||
      l.category.toLowerCase().includes(q)
    );
    renderLeadsTable(filtered);
  });

  // Pipeline Run Form Submit
  document.getElementById('pipelineForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      search: document.getElementById('inputSearch').value,
      location: document.getElementById('inputLocation').value,
      max: document.getElementById('inputMax').value,
      recipient: document.getElementById('inputRecipient').value,
      dryRun: document.getElementById('checkDryRun').checked,
    };

    try {
      document.getElementById('btnSubmitRun').disabled = true;
      document.getElementById('btnSubmitRun').textContent = 'Starting Pipeline...';

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      } else {
        startLogPolling();
      }
    } catch (err) {
      alert(`Failed to launch pipeline: ${err.message}`);
    } finally {
      document.getElementById('btnSubmitRun').disabled = false;
      document.getElementById('btnSubmitRun').textContent = 'Start AI Automation Pipeline';
    }
  });

  // Trigger Follow-up Check
  document.getElementById('btnRunFollowup').addEventListener('click', async () => {
    if (!confirm('Run follow-up check now? This will send follow-ups to leads past 3 days.')) return;
    try {
      const res = await fetch('/api/followup', { method: 'POST' });
      const data = await res.json();
      alert(`Follow-Up Check Done: ${data.sent || 0} sent, ${data.skipped || 0} skipped.`);
      fetchStats();
      fetchLeads();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  });

  // Manual Lead Modal Open / Close
  document.getElementById('btnOpenManualModal').addEventListener('click', () => {
    document.getElementById('manualModal').style.display = 'flex';
  });

  document.getElementById('btnCloseManualModal').addEventListener('click', () => {
    document.getElementById('manualModal').style.display = 'none';
  });

  // Manual Lead Form Submit
  document.getElementById('manualLeadForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      name: document.getElementById('manualName').value,
      category: document.getElementById('manualCategory').value,
      city: document.getElementById('manualCity').value,
      address: document.getElementById('manualAddress').value,
      phone: document.getElementById('manualPhone').value,
      email: document.getElementById('manualEmail').value,
      dryRun: document.getElementById('manualDryRun').checked,
    };

    const submitBtn = document.getElementById('btnSubmitManual');

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing Custom Lead with Gemini AI...';

      const res = await fetch('/api/leads/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      } else {
        const data = await res.json();
        alert(`✅ Custom lead processed successfully!\n\nBusiness: ${payload.name}\nDemo Site: ${data.demoUrl || 'Generated'}`);
        document.getElementById('manualModal').style.display = 'none';
        document.getElementById('manualLeadForm').reset();
        fetchStats();
        fetchLeads();
      }
    } catch (err) {
      alert(`Failed to process manual lead: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Process Custom Lead Now';
    }
  });

  document.getElementById('btnCloseEmailModal').addEventListener('click', () => {
    document.getElementById('emailModal').style.display = 'none';
  });
}

// ---------------------------------------------------------------------------
// Modal Actions
// ---------------------------------------------------------------------------

window.previewSite = function(url, title) {
  document.getElementById('modalSiteTitle').textContent = `Demo Site Preview — ${title}`;
  document.getElementById('siteIframe').src = url;
  document.getElementById('modalOpenExternal').href = url;
  document.getElementById('siteModal').style.display = 'flex';
};

window.viewEmail = async function(slug, title) {
  document.getElementById('modalEmailTitle').textContent = `Email Content — ${title}`;
  document.getElementById('emailSubject').value = 'Loading...';
  document.getElementById('emailBodyContainer').innerHTML = 'Loading email preview...';
  document.getElementById('emailModal').style.display = 'flex';

  try {
    const res = await fetch(`/api/emails/${slug}`);
    if (!res.ok) throw new Error('No saved email found');
    const data = await res.json();

    document.getElementById('emailSubject').value = data.subject || 'N/A';
    document.getElementById('emailBodyContainer').innerHTML = data.htmlBody || data.textBody || 'No body content';
  } catch {
    document.getElementById('emailSubject').value = `Demo Website built for ${title}`;
    document.getElementById('emailBodyContainer').innerHTML = `<p>Initial email generated & dispatched. (Saved JSON content not found for offline preview)</p>`;
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeQuotes(str) {
  return String(str || '').replace(/'/g, "\\'");
}
