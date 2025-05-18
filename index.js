import { MODELS_JSON } from '@cloudflare/kv-asset-handler';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const COST_LIMIT     = 2.0;   // $ – toplam maliyet üst sınırı

/* ---------- Yardımcılar ---------------------------------------------- */
// Serinin adını, model ismindeki ilk ":" öncesinden alır
const seriesName   = name => name.split(':')[0].trim();

// Varyant adını, ilk ":" sonrasından alır
const variantName  = name => {
  const parts = name.split(':');
  return parts.length > 1 ? parts.slice(1).join(':').trim() : name.trim();
};

// Text vs. multimodal
const modality = pricing => (+pricing.image > 0 ? 'multimodal' : 'text');

// pricing objesindeki TÜM sayısal alanları topla
const priceTotal = pricing =>
  Object.values(pricing).reduce((sum, v) => sum + (+v || 0), 0);

/* ---------- OpenRouter’dan modelleri çek ----------------------------- */
const fetchRemoteModels = async env => {
  const res  = await fetch(OPENROUTER_URL, {
    headers: { Authorization: env.OPENROUTER_KEY }
  });
  const data = await res.json();
  return data?.data || [];
};

/* ---------- Senkronizasyon ------------------------------------------- */
async function syncModels(env) {
  const models   = await fetchRemoteModels(env);
  const grouped  = {};                               // { ChatGPT:{ '4o-mini':{…} } }

  for (const m of models) {
    if (priceTotal(m.pricing) > COST_LIMIT) continue; // pahalı → atla

    const series  = seriesName(m.name);
    const variant = variantName(m.name);

    if (!grouped[series]) grouped[series] = {};

    grouped[series][variant] = {
      id:          m.id,
      title:       m.name,
      description: m.description || '',
      context:     m.context_length,
      modality:    modality(m.pricing),
      reasoning:   +m.pricing.internal_reasoning > 0,
      webSearch:   +m.pricing.web_search        > 0
    };
  }

  await MODELS_JSON.put(
    'list',
    JSON.stringify({ version: new Date().toISOString(), series: grouped })
  );
}

/* ---------- Worker Olayları ------------------------------------------ */
export default {
  async scheduled(event, env) {
    event.waitUntil(syncModels(env));      // cron tetikleyici (wrangler.toml’daki 0 * * * *)
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
