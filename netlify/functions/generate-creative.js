// SYCCO Creative Studio — AI Content Generator
// Receives campaign inputs → calls Claude → returns structured creative outputs

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let data;
  try { data = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const {
    business_name, product, audience, offer, cta,
    creative_mode, platform, video_length, mood
  } = data;

  const modeGuides = {
    'Commercial Mode': 'polished, professional, brand-safe. Clean visuals, credible tone, trust signals.',
    'Luxury Brand Mode': 'high-end aesthetic. Slow pacing, rich textures, minimal copy, aspirational lifestyle.',
    'Viral TikTok Mode': 'fast cuts, trending audio energy, relatable hook, unexpected twist, native feel.',
    'Cinematic Trailer Mode': 'epic pacing, dramatic music cues, intense visuals, movie-quality narration.',
    'UGC Ad Mode': 'authentic, unpolished, first-person POV, real testimonial energy, raw and believable.',
    'Psycho Hook Mode': 'pattern interrupting open, controversial or shocking first frame, stops the scroll dead.',
    'Storytelling Mode': 'narrative arc, problem → journey → transformation, emotionally resonant.',
    'Dark Luxury Mode': 'moody, high-contrast, mysterious tone, premium dark aesthetics, minimalist.',
    'Comedy Ad Mode': 'timing-driven humor, unexpected punchline, self-aware, memorable and shareable.'
  };

  const platformGuides = {
    'TikTok': '9:16 vertical, hook in first 1-2 seconds, native/authentic feel, trending energy',
    'Instagram Reels': '9:16 vertical, visually strong first frame, aesthetic-forward',
    'YouTube Shorts': '9:16 vertical, slightly longer hook window, can be more direct',
    'Facebook Ad': '1:1 or 4:5, performance-focused, clear value prop, strong CTA',
    'YouTube Ad': '16:9 horizontal, 5 second skip threshold, hook before skip',
    'LinkedIn': '16:9 horizontal, professional tone, B2B angle'
  };

  const guide = modeGuides[creative_mode] || 'professional and engaging';
  const platGuide = platformGuides[platform] || 'standard digital ad format';

  const prompt = `You are a world-class creative director and ad copywriter specializing in AI-powered video ads and digital campaigns.

A client needs a complete creative package for their business. Generate ALL outputs as a single valid JSON object.

CLIENT BRIEF:
- Business: ${business_name}
- Product/Service: ${product}
- Target Audience: ${audience}
- Offer/Hook: ${offer || 'Not specified'}
- Call to Action: ${cta || 'Learn More'}
- Creative Mode: ${creative_mode} — Style guide: ${guide}
- Platform: ${platform} — Format: ${platGuide}
- Video Length: ${video_length}
- Mood/Tone: ${mood || 'Engaging and compelling'}

Generate a complete creative package as JSON (no markdown, no explanation, just the JSON):
{
  "video_prompt": "<A detailed, director-level cinematic video prompt. Describe shots, lighting, pacing, subjects, atmosphere, color grading, and movement. Make it specific enough for an AI video model to execute. Tailored to ${creative_mode} and ${platform}. ${video_length} long.>",
  "scene_breakdown": ["<Scene 1: 0-Xs — description>", "<Scene 2: Xs-Ys — description>", "<Scene 3: final — description>"],
  "voiceover_script": "<Complete word-for-word voiceover script timed to ${video_length}. Punchy, ${mood || 'engaging'} delivery. Matches the ${creative_mode} energy.>",
  "image_prompt": "<A detailed prompt for an AI image generator (Midjourney/DALL-E style). One key hero image for the campaign. Describe style, lighting, subject, composition, mood.>",
  "hook_options": ["<Hook option 1 — opening line that stops the scroll>", "<Hook option 2 — different angle>", "<Hook option 3 — pattern interrupt>"],
  "caption": "<Platform-optimized caption for ${platform}. Opening line grabs attention. 3-5 sentences max. Ends with CTA.>",
  "hashtags": ["<hashtag1>", "<hashtag2>", "<hashtag3>", "<hashtag4>", "<hashtag5>", "<hashtag6>", "<hashtag7>", "<hashtag8>"],
  "cta_variations": ["<CTA variation 1>", "<CTA variation 2>", "<CTA variation 3>"],
  "landing_headline": "<Hero headline for a landing page. Outcome-focused, speaks to ${audience}, creates desire.>",
  "landing_subheadline": "<Supporting subheadline that adds proof or specificity.>",
  "ad_angles": [
    {"angle": "<Angle 1 name>", "hook": "<First 3-4 words>", "concept": "<What makes this version work>"},
    {"angle": "<Angle 2 name>", "hook": "<First 3-4 words>", "concept": "<What makes this version work>"},
    {"angle": "<Angle 3 name>", "hook": "<First 3-4 words>", "concept": "<What makes this version work>"}
  ],
  "campaign_name": "<A short, memorable internal name for this campaign>"
}

Rules:
- Every output must be specific to ${business_name} and ${product} — no generic filler
- Match ${creative_mode} energy throughout ALL outputs
- The video_prompt should be detailed enough to paste directly into Kling, Seedance, or Runway
- Hook options should feel genuinely scroll-stopping for ${audience} on ${platform}
- Hashtags must be real, relevant, and a mix of broad and niche`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await res.json();
    const text = claudeData?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) throw new Error('No JSON in response');
    const output = JSON.parse(match[0]);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, output }) };

  } catch (e) {
    console.error('Generate error:', e.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ success: false, error: 'Generation failed. Check your API key configuration.' })
    };
  }
};
