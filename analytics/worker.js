const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function hourKey() {
  return `stats:${new Date().toISOString().slice(0, 13)}`;
}

function emptyBucket() {
  return {
    page_loads: 0, game_starts: 0, deaths: 0,
    total_session_ms: 0, session_count: 0,
    wave_deaths: {}, weapon_picks: {}, total_kills: 0,
  };
}

function merge(bucket, event) {
  switch (event.type) {
    case 'page_load': bucket.page_loads++; break;
    case 'game_start': bucket.game_starts++; break;
    case 'death':
      bucket.deaths++;
      bucket.total_kills += event.kills || 0;
      const wave = String(event.wave || 0);
      bucket.wave_deaths[wave] = (bucket.wave_deaths[wave] || 0) + 1;
      if (event.weapons) {
        for (const w of event.weapons) {
          bucket.weapon_picks[w] = (bucket.weapon_picks[w] || 0) + 1;
        }
      }
      break;
    case 'session_end':
      if (event.duration_ms) {
        bucket.total_session_ms += event.duration_ms;
        bucket.session_count++;
      }
      break;
  }
  return bucket;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/event') {
      const event = await request.json();
      if (!event.type) return new Response('missing type', { status: 400, headers: CORS_HEADERS });
      const key = hourKey();
      const existing = await env.SURVIVORS_ANALYTICS.get(key, 'json');
      const bucket = merge(existing || emptyBucket(), event);
      await env.SURVIVORS_ANALYTICS.put(key, JSON.stringify(bucket), { expirationTtl: 60 * 60 * 24 * 90 });
      return new Response('ok', { headers: CORS_HEADERS });
    }

    if (request.method === 'GET' && url.pathname === '/stats') {
      const hours = Math.min(parseInt(url.searchParams.get('hours') || '24'), 720);
      const now = new Date();
      const results = [];
      for (let i = 0; i < hours; i++) {
        const t = new Date(now - i * 3600000);
        const key = `stats:${t.toISOString().slice(0, 13)}`;
        const data = await env.SURVIVORS_ANALYTICS.get(key, 'json');
        if (data) results.push({ hour: key.slice(6), ...data });
      }
      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // --- leaderboard ---
    if (request.method === 'POST' && url.pathname === '/leaderboard') {
      const entry = await request.json();
      if (!entry.name || !entry.wave || entry.kills === undefined) {
        return new Response('missing fields', { status: 400, headers: CORS_HEADERS });
      }
      const score = {
        name: String(entry.name).slice(0, 20),
        wave: Math.max(1, Math.floor(entry.wave)),
        kills: Math.max(0, Math.floor(entry.kills)),
        time: Math.max(0, Math.floor(entry.time || 0)),
        weapons: (entry.weapons || []).slice(0, 8),
        date: new Date().toISOString().slice(0, 10),
      };
      // fetch current leaderboard, insert if qualifies, keep top 50
      const lb = await env.SURVIVORS_ANALYTICS.get('leaderboard', 'json') || [];
      lb.push(score);
      lb.sort((a, b) => b.wave - a.wave || b.kills - a.kills || a.time - b.time);
      const trimmed = lb.slice(0, 50);
      await env.SURVIVORS_ANALYTICS.put('leaderboard', JSON.stringify(trimmed));
      const rank = trimmed.findIndex(s => s === score) + 1;
      return new Response(JSON.stringify({ rank, total: trimmed.length }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (request.method === 'GET' && url.pathname === '/leaderboard') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
      const lb = await env.SURVIVORS_ANALYTICS.get('leaderboard', 'json') || [];
      return new Response(JSON.stringify(lb.slice(0, limit), null, 2), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    return new Response('not found', { status: 404, headers: CORS_HEADERS });
  },
};
