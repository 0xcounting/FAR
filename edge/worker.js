// Optional Cloudflare Worker in front of an R2 bucket holding dist/.
//
// GitHub Pages is the canonical origin and needs none of this. This exists for
// the case where you want a custom domain, control over cache headers, and
// R2's zero egress cost.
//
// Deploy:  cd edge && npx wrangler deploy
// Sync:    the `r2` job in .github/workflows/deploy.yml
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method_not_allowed' }, 405);
    }
    const url = new URL(request.url);
    let key = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (key === '') key = 'index.html';

    // Every route in this registry is a literal object key. Rejecting traversal
    // outright is cheaper than normalising it, and there is no legitimate "..".
    if (key.includes('..')) return json({ error: 'bad_request' }, 400);

    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;

    const object = await env.FAR_BUCKET.get(key);
    if (!object) {
      // A 404 here is a normal answer, not an error: "no asset by that name" is
      // exactly what a resolver should say. Keep it cheap and cacheable.
      return json({ error: 'not_found', path: key, docs: 'https://github.com/0xcounting/FAR' }, 404, {
        'cache-control': 'public, max-age=60',
      });
    }

    const headers = new Headers({
      'content-type': key.endsWith('.html') ? 'text/html; charset=utf-8'
        : key.endsWith('.gz') ? 'application/json'
        : 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      // Content changes only when a build is published, and a build publishes a
      // new manifest. Five minutes at the edge with a long stale window keeps
      // reads free and still lets a correction propagate quickly.
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      etag: object.httpEtag,
    });
    if (key.endsWith('.gz')) headers.set('content-encoding', 'gzip');

    const response = new Response(request.method === 'HEAD' ? null : object.body, { headers });
    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
};

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra },
  });
