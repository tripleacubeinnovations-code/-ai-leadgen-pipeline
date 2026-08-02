# 🤖 AI Lead-Gen Automation Pipeline

An end-to-end lead generation automation tool that discovers local businesses without websites, builds stunning demo sites for them using AI, deploys them live, and runs personalized cold email outreach with automated follow-ups.

**Built by TripleACube Innovations**

---

## 🏗️ Architecture

```
ai-leadgen-pipeline/
├── src/
│   ├── modules/
│   │   ├── leadFinder.js        # Google Places API — find businesses without websites
│   │   ├── siteGenerator.js     # OpenAI — generate single-file HTML/CSS websites
│   │   ├── siteDeployer.js      # Vercel API — deploy sites to live URLs
│   │   ├── emailGenerator.js    # OpenAI — write personalized cold emails
│   │   ├── emailSender.js       # Mailgun — send emails with compliance
│   │   ├── logger.js            # Google Sheets — log leads and results
│   │   └── followUp.js          # Retry sequence — 3-day follow-up emails
│   ├── pipeline.js              # Orchestrator — runs full pipeline with concurrency
│   ├── cli.js                   # CLI — command-line interface with 7 commands
│   └── config.js                # Config — centralized env var loader
├── generated-sites/             # Generated HTML files (auto-created)
├── data/                        # Lead state, logs, results (auto-created)
├── credentials/                 # Google service account key (you provide)
├── .env.example                 # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js** v18+ installed
- API keys for: Google Places, OpenAI, Vercel, Mailgun, Google Sheets

### 2. Install

```bash
cd ai-leadgen-pipeline
npm install
```

### 3. Configure

```bash
# Copy the template
cp .env.example .env

# Edit .env with your API keys
```

### 4. Verify Setup

```bash
node src/cli.js check-config
```

### 5. Run the Pipeline

```bash
# Full pipeline (find → generate → deploy → email → log)
node src/cli.js run --search "plumber" --location "Mumbai, India" --max 5

# Dry run (preview everything without sending emails or deploying)
node src/cli.js run --search "plumber" --location "Mumbai, India" --dry-run
```

---

## 📋 Commands Reference

### Full Pipeline

```bash
node src/cli.js run -s <search> -l <location> [options]
```

| Flag | Description | Default |
|---|---|---|
| `-s, --search <term>` | Business type (e.g., "plumber") | **Required** |
| `-l, --location <place>` | Location (e.g., "Austin, TX") | **Required** |
| `-m, --max <number>` | Max leads to process | `10` |
| `--dry-run` | Preview without sending/deploying | `false` |
| `--skip-deploy` | Skip Vercel deployment | `false` |
| `--skip-email` | Skip email generation/sending | `false` |
| `--skip-log` | Skip Google Sheets logging | `false` |
| `--follow-up` | Start follow-up scheduler after | `false` |
| `--recipient <email>` | Override all recipient emails | — |

### Individual Steps

```bash
# 1. Find leads only
node src/cli.js find-leads -s "dentist" -l "Austin, TX" --max 20

# 2. Generate demo sites
node src/cli.js generate-site --lead-file data/leads.json --index 0
node src/cli.js generate-site --lead-file data/leads.json --all

# 3. Deploy sites to Vercel
node src/cli.js deploy-sites --lead-file data/leads.json

# 4. Send emails
node src/cli.js send-emails --results-file data/pipeline-results.json
node src/cli.js send-emails --dry-run --recipient test@example.com

# 5. Follow-up check
node src/cli.js follow-up
node src/cli.js follow-up --schedule   # Keep running as cron

# 6. Validate config
node src/cli.js check-config
```

---

## 🔑 API Setup Guide

### Google Places API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **"Places API (New)"**
4. Create an API key under Credentials
5. Add to `.env` as `GOOGLE_PLACES_API_KEY`

### OpenAI API

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Add to `.env` as `OPENAI_API_KEY`

### Vercel

1. Go to [Vercel Dashboard](https://vercel.com/account/tokens)
2. Create a new token
3. Add to `.env` as `VERCEL_TOKEN`

### Mailgun

1. Sign up at [Mailgun](https://www.mailgun.com/)
2. Verify a domain (or use sandbox for testing)
3. Get API key from Settings → API Security
4. Add `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` to `.env`

### Google Sheets

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **"Google Sheets API"**
3. Create a **Service Account** under Credentials
4. Download the JSON key file → save as `credentials/service-account.json`
5. Create a Google Sheet and **share it** with the service account email
6. Copy the spreadsheet ID from the URL → add to `.env` as `GOOGLE_SHEETS_ID`

---

## 🔄 Follow-Up Sequence

The pipeline includes an automatic follow-up system:

1. After sending an initial email, the lead is tracked in `data/leads-state.json`
2. After 3 days (configurable via `FOLLOW_UP_DELAY_DAYS`), a shorter follow-up email is generated and sent
3. The follow-up can be triggered:
   - **Manually**: `node src/cli.js follow-up`
   - **Automatically**: `node src/cli.js follow-up --schedule` (runs daily at 9 AM by default)
   - **With pipeline**: `node src/cli.js run ... --follow-up`

---

## ⚙️ Configuration Reference

All settings are in `.env`. See `.env.example` for the full list with comments.

| Variable | Description | Required |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Places API key | ✅ |
| `OPENAI_API_KEY` | OpenAI API key | ✅ |
| `OPENAI_MODEL` | LLM model (default: `gpt-4o`) | ❌ |
| `VERCEL_TOKEN` | Vercel deployment token | ✅ |
| `MAILGUN_API_KEY` | Mailgun API key | ✅ |
| `MAILGUN_DOMAIN` | Verified Mailgun domain | ✅ |
| `GOOGLE_SHEETS_ID` | Target spreadsheet ID | ✅ |
| `FOLLOW_UP_DELAY_DAYS` | Days before follow-up (default: 3) | ❌ |
| `CONCURRENCY_LIMIT` | Parallel operations (default: 3) | ❌ |
| `DRY_RUN` | Skip sending/deploying (default: false) | ❌ |

---

## 📂 Output Files

| File | Description |
|---|---|
| `data/leads.json` | Raw leads from Google Places search |
| `data/pipeline-results.json` | Full pipeline results per lead |
| `data/pipeline-log.json` | Local log of all processed leads |
| `data/leads-state.json` | Follow-up tracking state |
| `data/emails/*.json` | Saved email content (when no recipient) |
| `data/deployments.json` | Vercel deployment URLs |
| `generated-sites/*.html` | Generated HTML demo websites |

---

## ⚠️ Legal Compliance

- This tool adds an unsubscribe link to all outgoing emails
- All email activity is logged for audit purposes
- You are responsible for compliance with CAN-SPAM, GDPR, and local email laws
- Always obtain proper consent before sending commercial emails
- Respect opt-out requests immediately

---

## 🛠️ Troubleshooting

| Issue | Solution |
|---|---|
| `Google Places API error (403)` | Check API key, ensure Places API (New) is enabled |
| `OpenAI rate limit` | Reduce `CONCURRENCY_LIMIT` or wait |
| `Vercel deployment failed` | Check token permissions, verify team ID |
| `Mailgun 401` | Verify API key and domain |
| `Google Sheets error` | Share sheet with service account email |
| `No leads found` | Try broader search terms or different locations |

---

## License

Private — TripleACube Innovations
