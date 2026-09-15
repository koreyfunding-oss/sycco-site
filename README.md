# SYCCO — Someone You Can Count On

Static site files for the SYCCO ecosystem.

## Pages

| File | URL Path | Description |
|---|---|---|
| `index.html` | `/` | Main landing page — 12-month wealth roadmap assessment |
| `affiliates.html` | `/affiliates` | Affiliate program — 40% commission model |
| `favicon.svg` | `/favicon.svg` | SYCCO "S" favicon |

## What's included

- ✅ GA4 analytics (`G-T3H1725GD2`)
- ✅ LeadConnector chat widget (auto-opens after 1.5s on landing page)
- ✅ GHL Inbound Webhook for assessment leads
- ✅ Privacy Policy + Terms of Service footer links
- ✅ 7-step assessment modal with lead capture
- ✅ Affiliate payout calculator (live 40% math)
- ✅ Animated AI mentor portal demo
- ✅ Fully self-contained (no build step, no frameworks)

## Deployment

These are static HTML files. Deploy them anywhere:
- **GitHub Pages** — enable in repo Settings → Pages
- **Netlify / Vercel / Cloudflare Pages** — connect this repo
- **Any web server** — just serve the files

For the affiliate page to be reachable at `/affiliates` (without `.html`), configure your host's URL rewrite rules to serve `affiliates.html` at that path.
