import { MODELS_JSON } from '@cloudflare/kv-asset-handler';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

async function fetchRemoteModels(env) {
  const res = await fetch(OPENROUTER_URL, {
    headers: {
      Authorization: env.OPENROUTER_KEY
    }
  });
  return res.json();
}

function categorize(modelId) {
  if (modelId.startsWith('google/')) return 'Gemini';
  if (modelId.startsWith('openai/')) return 'ChatGPT';
  if (modelId.startsWith('anthropic/')) return 'Anthropic';
  // Diğer prefix'ler...
  return 'Other';
}

async function genDescription(id, env) {
  const prompt = `Give a short and long description for the model ${id}.`;
  const res = await fetch(OPENAI_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': env.OPENAI_KEY
    },
    body: JSON.stringify({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  const text = data.choices[0].message.content;
  return {
    short: text.split('\n')[0],
    long: text
  };
}

async function syncModels(env) {
  // 1) Eski JSON'u oku
  const oldJson = (await MODELS_JSON.get('list', 'json')) || { models: [] };
  // 2) Yeni listeleri çek
  const remote = await fetchRemoteModels(env);
  // 3) Diff & Açıklama üret
  const enhanced = await Promise.all(
    remote.map(async m => {
      const existing = oldJson.models.find(o => o.id === m.id);
      const desc = existing
        ? { short: existing.shortDescription, long: existing.description }
        : await genDescription(m.id, env);
      return {
        id: m.id,
        title: m.title,
        category: categorize(m.id),
        image: `https://vertexishere.com/assets/models/${m.id.split('/')[0]}.png`,
        shortDescription: desc.short,
        description: desc.long
      };
    })
  );
  // 4) Versiyon ekle ve KV'ye yaz
  const payload = { version: new Date().toISOString(), models: enhanced };
  await MODELS_JSON.put('list', JSON.stringify(payload));
}

export default {
  async scheduled(event, env) {
    event.waitUntil(syncModels(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/models.json') {
      const body = await MODELS_JSON.get('list');
      return new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
        }
      });
    }
    return new Response('Not Found', { status: 404 });
  }
};
