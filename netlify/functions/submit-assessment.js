// SYCCO.AI — Revenue Leak Assessment Handler
// Receives intake form data → runs TWO Claude calls in parallel:
//   1. Revenue Leak Report
//   2. Creative Sample (ad concept built from their assessment data)
// → emails full report → returns both summaries to client

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let data;
  try { data = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const claude = (prompt, maxTokens = 2048) =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    }).then(r => r.json());

  // ── Run both Claude calls in parallel ──────────────────────────────────────
  let report = null, creative = null;
  try {
    const [reportRes, creativeRes] = await Promise.all([
      claude(reportPrompt(data), 2048),
      claude(creativePrompt(data), 1024)
    ]);

    const parseJSON = (res) => {
      const text = res?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    };

    report   = parseJSON(reportRes)   || fallbackReport(data);
    creative = parseJSON(creativeRes) || fallbackCreative(data);
  } catch (e) {
    console.error('Claude parallel error:', e.message);
    report   = report   || fallbackReport(data);
    creative = creative || fallbackCreative(data);
  }

  // ── Send emails ─────────────────────────────────────────────────────────────
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM       = process.env.RESEND_FROM  || 'reports@sycco.xyz';
  const OWNER      = process.env.OWNER_EMAIL  || 'hello@sycco.xyz';

  if (RESEND_KEY) {
    const send = (payload) =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    try { await send({ from: `SYCCO.AI <${FROM}>`, to: [data.email], subject: `Your Revenue Leak Report + Ad Campaign — ${data.business_name}`, html: leadEmail(data, report, creative) }); }
    catch (e) { console.error('Lead email error:', e.message); }
    try { await send({ from: `SYCCO.AI Intake <${FROM}>`, to: [OWNER], subject: `🔔 New Lead: ${data.business_name} (${data.industry}) — Score ${report.score}/100`, html: ownerEmail(data, report) }); }
    catch (e) { console.error('Owner email error:', e.message); }
  }

  // ── Return both summaries to client ────────────────────────────────────────
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      summary: {
        name:             data.name,
        business:         data.business_name,
        industry:         data.industry,
        score:            report.score,
        headline:         report.headline,
        monthly_leak_low: report.monthly_leak_low,
        monthly_leak_high:report.monthly_leak_high,
        summary:          report.summary,
        urgency_note:     report.urgency_note,
        critical_gaps:    (report.critical_gaps   || []).slice(0, 3),
        quick_wins:       (report.quick_wins      || []).slice(0, 3),
        tools_recommended:(report.tools_recommended||[]).slice(0, 3)
      },
      creative: {
        campaign_name:    creative.campaign_name,
        creative_mode:    creative.creative_mode,
        hook:             creative.hook,
        video_concept:    creative.video_concept,
        voiceover_teaser: creative.voiceover_teaser,
        image_concept:    creative.image_concept,
        caption_preview:  creative.caption_preview,
        locked_hint:      creative.locked_hint
      }
    })
  };
};

// ── Report Prompt ─────────────────────────────────────────────────────────────
function reportPrompt(d) {
  const sources = Array.isArray(d.lead_sources) ? d.lead_sources.join(', ') : 'unspecified';
  const tools   = Array.isArray(d.current_tools) ? d.current_tools.join(', ') : 'none listed';
  return `You are a business efficiency analyst for SYCCO.AI. A business just completed a Revenue Leak Assessment.

Analyze their data and return ONLY a valid JSON object — no markdown, no explanation, just the JSON.

ASSESSMENT DATA:
- Business: ${d.business_name}
- Industry: ${d.industry}
- Monthly Leads: ${d.monthly_leads}
- Lead Sources: ${sources}
- Response Time: ${d.response_time}
- Current Tools: ${tools}
- Main Problem: ${d.main_problem}
- AI Usage: ${d.ai_usage}

Return this exact JSON:
{
  "score": <integer 15-65, lower = worse. Most score 25-50.>,
  "monthly_leak_low": <conservative monthly USD leak — lead volume × avg deal for ${d.industry} × lost % from slow response>,
  "monthly_leak_high": <upper bound>,
  "headline": "<punchy 8-12 word headline specific to their situation>",
  "summary": "<2-3 sentences specific to their industry + main problem. Reference their own words.>",
  "urgency_note": "<1 sentence: what this costs per week unfixed>",
  "critical_gaps": [
    {"gap": "<title>", "impact": "<specific numbers>", "fix": "<concrete action>"}
  ],
  "quick_wins": ["<week 1 action>", "<week 1 action>", "<week 1 action>"],
  "tools_recommended": [
    {"name": "<tool>", "purpose": "<specific to their situation>", "cost": "<range>"}
  ]
}

Rules: exactly 3 gaps, 3 wins, 3 tools. Be specific to ${d.industry}. Reference response time "${d.response_time}" in impact.`;
}

// ── Creative Prompt ───────────────────────────────────────────────────────────
function creativePrompt(d) {
  const modeMap = {
    'Real Estate / Realtor':    'Storytelling Mode',
    'Mortgage Broker':          'Psycho Hook Mode',
    'Medical / Dental':         'Commercial Mode',
    'Med Spa / Aesthetics':     'Luxury Brand Mode',
    'Legal / Law Firm':         'Commercial Mode',
    'Roofing':                  'Psycho Hook Mode',
    'Solar':                    'Psycho Hook Mode',
    'HVAC / Home Services':     'Psycho Hook Mode',
    'Automotive':               'Viral TikTok Mode',
    'Insurance':                'Storytelling Mode',
    'Restaurant / Food':        'UGC Ad Mode',
    'E-Commerce':               'Viral TikTok Mode',
    'Coaching / Consulting':    'Storytelling Mode',
    'Marketing Agency':         'Dark Luxury Mode',
    'Contractor / Construction':'Psycho Hook Mode',
    'Chiropractor / Wellness':  'Cinematic Trailer Mode',
  };
  const mode     = modeMap[d.industry] || 'Viral TikTok Mode';
  const platform = Array.isArray(d.lead_sources) && d.lead_sources.includes('TikTok') ? 'TikTok' :
                   Array.isArray(d.lead_sources) && d.lead_sources.includes('Facebook / Instagram') ? 'Instagram Reels' : 'TikTok';

  return `You are a world-class ad creative director. A business just completed an assessment.
Use their data to build ONE compelling 15-second ad concept for them — as if you spotted their problem and immediately knew how to fix it with great creative.

BUSINESS DATA:
- Business: ${d.business_name}
- Industry: ${d.industry}
- Problem: ${d.main_problem}
- Monthly Leads: ${d.monthly_leads}
- Lead Sources: ${Array.isArray(d.lead_sources) ? d.lead_sources.join(', ') : 'various'}
- Best Platform for them: ${platform}
- Creative Mode to use: ${mode}

Return ONLY valid JSON — no markdown, no explanation:
{
  "campaign_name": "<Short memorable campaign name for ${d.business_name}>",
  "creative_mode": "${mode}",
  "platform": "${platform}",
  "hook": "<The first 1-2 sentences that stop the scroll. Must be specific to ${d.industry} and their problem. No generic filler.>",
  "video_concept": "<A vivid 2-3 sentence description of what the 15-second video looks like. Shots, energy, pacing. Specific to ${d.industry}.>",
  "voiceover_teaser": "<The first 2 lines of the voiceover script. Natural, conversational, ${mode} energy.>",
  "image_concept": "<One-sentence description of the hero image/thumbnail for this ad.>",
  "caption_preview": "<First sentence of the platform caption — something that makes them stop scrolling.>",
  "locked_hint": "<One teasing sentence about what the FULL creative package contains beyond this preview — make it compelling.>"
}

Rules:
- Hook must feel like it was written SPECIFICALLY for ${d.business_name} in ${d.industry}
- Reference their actual problem: "${d.main_problem}"
- The video_concept should be concrete enough to visualize
- NO generic phrases like "Are you tired of..." — be specific and fresh`;
}

// ── Fallbacks ─────────────────────────────────────────────────────────────────
function fallbackReport(d) {
  return {
    score: 38,
    monthly_leak_low: 3200, monthly_leak_high: 7800,
    headline: 'Your leads are leaking before the first conversation starts',
    summary: `${d.business_name} is experiencing the most common and costly pattern: leads coming in, not getting handled fast enough, and silently choosing someone else. Your challenge — "${d.main_problem}" — is fixable with the right systems in place.`,
    urgency_note: 'Every week without automated follow-up is another week competitors respond in 5 minutes while you respond in hours.',
    critical_gaps: [
      { gap: 'Slow Lead Response', impact: '78% of buyers choose the first responder — delays past 5 min cost 30–50% of inbound leads', fix: 'Deploy instant SMS + email the moment a lead comes in' },
      { gap: 'No After-Hours Coverage', impact: '40%+ of leads arrive after 5PM — no response until morning means they\'ve moved on', fix: 'Set up an AI chatbot that qualifies and books leads 24/7' },
      { gap: 'No Nurture Sequence', impact: '80% of deals close after 5+ touches — first contact is never enough on its own', fix: 'Build a 7-touch 14-day follow-up sequence via SMS + email' }
    ],
    quick_wins: [
      'Set up a Missed Call Text-Back so every missed call gets an instant SMS',
      'Create an auto-responder for all web form submissions within 90 seconds',
      'Build a 3-email follow-up for leads that don\'t respond within 24 hours'
    ],
    tools_recommended: [
      { name: 'GoHighLevel', purpose: 'CRM + SMS automation + booking in one platform', cost: '$97–$297/month' },
      { name: 'Twilio', purpose: 'Missed call text-back and SMS campaigns', cost: '$20–50/month + usage' },
      { name: 'Calendly', purpose: 'Automated booking with reminder sequences', cost: '$8–16/month' }
    ]
  };
}

function fallbackCreative(d) {
  return {
    campaign_name: d.business_name + ' — Wake Up Campaign',
    creative_mode: 'Psycho Hook Mode',
    platform: 'TikTok',
    hook: `Every day you don't have this system, you're handing your competitors $500. Here's exactly what ${d.business_name} is losing right now.`,
    video_concept: `Opens on a phone screen showing missed calls and unanswered forms piling up. Cut to a competitor's phone — notifications pinging, bookings rolling in. Final frame: ${d.business_name} logo with "Don't let this be you."`,
    voiceover_teaser: `"You're getting leads. You're just not responding fast enough to win them. Here's the system that changes that..."`,
    image_concept: `Split screen: left side shows chaos (missed calls, ignored forms), right side shows a clean dashboard with automated responses firing.`,
    caption_preview: `You don't have a lead problem. You have a follow-up problem. And it's costing you more than you think 👇`,
    locked_hint: `The full package includes your complete video prompt, scene breakdown, voiceover script, 3 scroll-stopping hooks, hashtags, and 3 ad angles — all built specifically for ${d.industry}.`
  };
}

// ── Lead email ─────────────────────────────────────────────────────────────────
function leadEmail(d, r, c) {
  const scoreColor = r.score < 40 ? '#d96f6f' : r.score < 60 ? '#e8a830' : '#5a9e6f';
  const riskLabel  = r.score < 40 ? 'HIGH RISK' : r.score < 60 ? 'MODERATE RISK' : 'LOW RISK';
  const gaps = (r.critical_gaps || []).map(g =>
    `<tr><td style="padding:12px 16px;border-bottom:1px solid #eee">
      <strong style="display:block;font-size:14px;color:#111;margin-bottom:3px">${g.gap}</strong>
      <span style="font-size:12px;color:#666;display:block;margin-bottom:3px">${g.impact}</span>
      <span style="font-size:11px;color:#999">Fix: ${g.fix}</span>
    </td></tr>`).join('');
  const wins = (r.quick_wins || []).map(w =>
    `<li style="padding:4px 0;font-size:13px;color:#444">${w}</li>`).join('');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:620px;margin:28px auto;background:#fff;border:1px solid #ddd">
  <div style="background:#080808;padding:22px 32px;text-align:center">
    <div style="font-size:20px;letter-spacing:0.12em;color:#C8A96E;font-weight:700;font-family:Georgia,serif">SYCCO.AI</div>
    <div style="font-size:10px;letter-spacing:0.18em;color:rgba(200,169,110,0.6);margin-top:3px;text-transform:uppercase">Revenue Leak Report + Ad Campaign</div>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:14px;color:#555;margin:0 0 6px">Hi ${d.name},</p>
    <p style="font-size:14px;color:#555;margin:0 0 24px">Here's everything we built for <strong>${d.business_name}</strong>.</p>

    <div style="background:#f8f8f8;border:1px solid #e5e5e5;padding:18px;text-align:center;margin-bottom:24px">
      <div style="font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#999;margin-bottom:6px">Efficiency Score</div>
      <div style="font-size:48px;font-weight:700;color:${scoreColor};line-height:1">${r.score}<span style="font-size:18px;color:#bbb">/100</span></div>
      <div style="display:inline-block;background:${scoreColor};color:#fff;font-size:10px;font-weight:700;letter-spacing:0.1em;padding:3px 10px;margin-top:6px">${riskLabel}</div>
      <p style="font-size:13px;color:#444;margin:12px 0 0;font-style:italic">"${r.headline}"</p>
    </div>

    <div style="background:#fffbf5;border-left:3px solid #C8A96E;padding:14px 16px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:#111;margin-bottom:4px;letter-spacing:0.06em;text-transform:uppercase">Estimated Monthly Revenue Leak</div>
      <div style="font-size:22px;font-weight:700;color:#C8A96E">$${r.monthly_leak_low?.toLocaleString()} – $${r.monthly_leak_high?.toLocaleString()}</div>
      <div style="font-size:11px;color:#999;margin-top:4px">${r.urgency_note}</div>
    </div>

    <div style="font-size:13px;font-weight:700;color:#111;margin-bottom:10px">Top 3 Gaps Found</div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;margin-bottom:24px">${gaps}</table>

    <div style="font-size:13px;font-weight:700;color:#111;margin-bottom:8px">Quick Wins — Do This Week</div>
    <ul style="margin:0 0 28px;padding-left:20px">${wins}</ul>

    <div style="background:#060810;border:1px solid #1a2030;padding:20px;margin-bottom:24px">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#00D4FF;margin-bottom:8px">We Also Built You An Ad</div>
      <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:6px">${c?.campaign_name || 'Your Campaign Concept'}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:12px">${c?.creative_mode || ''} · ${c?.platform || ''}</div>
      <div style="background:#0d1520;border-left:2px solid #00D4FF;padding:12px;margin-bottom:10px">
        <div style="font-size:11px;color:#00D4FF;margin-bottom:4px;letter-spacing:0.1em;text-transform:uppercase">Hook</div>
        <div style="font-size:14px;color:#fff;font-style:italic">"${c?.hook || ''}"</div>
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,0.45)">${c?.locked_hint || 'Full video prompt, voiceover, hooks, hashtags and more are waiting in the Creative Studio.'}</div>
    </div>

    <div style="background:#080808;padding:20px;text-align:center">
      <div style="font-size:13px;color:#C8A96E;font-weight:700;margin-bottom:6px">See everything — and unlock your Creative Studio</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:16px">Your full report, complete ad package, and access to generate unlimited campaigns.</div>
      <a href="https://sycco.xyz/assessment-received.html" style="display:inline-block;background:#C8A96E;color:#080808;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:12px 28px;text-decoration:none">View Full Report + Unlock Studio →</a>
    </div>
  </div>
  <div style="padding:16px;text-align:center;font-size:10px;color:#bbb">SYCCO.AI · Someone You Can Count On · 8301 W Washington St #9 · Peoria, AZ 85345</div>
</div></body></html>`;
}

// ── Owner notification email ──────────────────────────────────────────────────
function ownerEmail(d, r) {
  const sources = Array.isArray(d.lead_sources) ? d.lead_sources.join(', ') : '—';
  const tools   = Array.isArray(d.current_tools) ? d.current_tools.join(', ') : 'None';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #ddd;padding:28px">
  <h2 style="margin:0 0 4px;color:#111">New Assessment Lead</h2>
  <p style="margin:0 0 20px;color:#888;font-size:13px">SYCCO.AI · Score: <strong style="color:#C8A96E">${r.score}/100</strong> · Est. leak: <strong>$${r.monthly_leak_low?.toLocaleString()}–$${r.monthly_leak_high?.toLocaleString()}/mo</strong></p>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <tr><td style="padding:7px 0;color:#888;width:130px">Name</td><td style="color:#111;font-weight:600">${d.name}</td></tr>
    <tr><td style="padding:7px 0;color:#888">Business</td><td>${d.business_name}</td></tr>
    <tr><td style="padding:7px 0;color:#888">Industry</td><td>${d.industry}</td></tr>
    <tr><td style="padding:7px 0;color:#888">Email</td><td><a href="mailto:${d.email}" style="color:#C8A96E">${d.email}</a></td></tr>
    <tr><td style="padding:7px 0;color:#888">Phone</td><td><a href="tel:${d.phone}" style="color:#C8A96E">${d.phone}</a></td></tr>
    <tr><td style="padding:7px 0;color:#888">Monthly Leads</td><td>${d.monthly_leads}</td></tr>
    <tr><td style="padding:7px 0;color:#888">Response Time</td><td>${d.response_time}</td></tr>
    <tr><td style="padding:7px 0;color:#888">Lead Sources</td><td>${sources}</td></tr>
    <tr><td style="padding:7px 0;color:#888">Tools</td><td>${tools}</td></tr>
    <tr><td style="padding:7px 0;color:#888">AI Usage</td><td>${d.ai_usage}</td></tr>
  </table>
  <hr style="margin:18px 0;border:none;border-top:1px solid #eee">
  <p style="font-size:12px;color:#999;margin:0 0 4px">Their problem:</p>
  <p style="font-size:14px;color:#111;font-style:italic;margin:0">"${d.main_problem}"</p>
</div></body></html>`;
}
