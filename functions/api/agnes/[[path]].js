const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const AGNES_VIDEO_STATUS_URL = 'https://apihub.agnes-ai.com/agnesapi';

const FALLBACK_MODELS = [
  { id: 'agnes-2.0-flash', object: 'model', kind: 'chat' },
  { id: 'agnes-image-2.1-flash', object: 'model', kind: 'image' },
  { id: 'agnes-image-2.0-flash', object: 'model', kind: 'image' },
  { id: 'agnes-video-v2.0', object: 'model', kind: 'video' }
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || new URL(request.url).origin;
  const siteOrigin = new URL(request.url).origin;
  return origin === siteOrigin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    : {};
}

function json(request, data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...(init.headers || {})
    }
  });
}

function getApiKey(env) {
  return env.AGNES_API_KEY || env.AGNES_KEY || env.OPENAI_API_KEY || '';
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function proxyAgnes(request, env, endpoint, body) {
  const apiKey = getApiKey(env);
  if (!apiKey) {
    return json(
      request,
      { error: 'Missing AGNES_API_KEY. Set it in Cloudflare Pages environment variables or Worker secrets.' },
      { status: 500 }
    );
  }

  const upstream = await fetch(`${env.AGNES_BASE_URL || AGNES_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
      ...corsHeaders(request)
    }
  });
}

async function models(request, env) {
  const apiKey = getApiKey(env);
  if (!apiKey) return json(request, { data: FALLBACK_MODELS, fallback: true });

  try {
    const upstream = await fetch(`${env.AGNES_BASE_URL || AGNES_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!upstream.ok) throw new Error(`Models endpoint returned ${upstream.status}`);
    const data = await upstream.json();
    if (!Array.isArray(data.data) || data.data.length === 0) {
      return json(request, { data: FALLBACK_MODELS, fallback: true });
    }
    return json(request, data);
  } catch {
    return json(request, { data: FALLBACK_MODELS, fallback: true });
  }
}

async function videoStatus(request, env, id) {
  const apiKey = getApiKey(env);
  if (!apiKey) {
    return json(
      request,
      { error: 'Missing AGNES_API_KEY. Set it in Cloudflare Pages environment variables or Worker secrets.' },
      { status: 500 }
    );
  }

  const url = new URL(env.AGNES_VIDEO_STATUS_URL || AGNES_VIDEO_STATUS_URL);
  url.searchParams.set('video_id', id);
  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
      ...corsHeaders(request)
    }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request) });

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const action = parts[2] || 'models';
  const id = parts[3] || '';

  try {
    if (request.method === 'GET' && action === 'models') return models(request, env);
    if (request.method === 'GET' && action === 'videos' && id) return videoStatus(request, env, id);
    if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, { status: 405 });

    const body = await readJson(request);
    if (action === 'chat') return proxyAgnes(request, env, '/chat/completions', body);
    if (action === 'images') return proxyAgnes(request, env, '/images/generations', body);
    if (action === 'videos') return proxyAgnes(request, env, '/videos', body);

    return json(request, { error: 'Unknown Agnes API route' }, { status: 404 });
  } catch (err) {
    return json(request, { error: err.message || 'Agnes proxy failed' }, { status: 500 });
  }
}
