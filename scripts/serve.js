#!/usr/bin/env node
// Serves dist/ the way the edge does, so you can check routing locally:
//   node src/build.js && node scripts/serve.js
//   curl -s localhost:8787/name/tether.json | head -c 400
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const ROOT = process.env.FAR_OUT ?? 'dist';
const PORT = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  // normalize() collapses "..", so a request cannot escape ROOT.
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  // Match GitHub Pages: "/" serves index.html (the docs page), while
  // "/index.json" remains the machine-readable route. Serving index.json at "/"
  // locally would mean the dev server disagrees with production about the one
  // URL a human is most likely to open.
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8'
        : file.endsWith('.gz') ? 'application/gzip'
        : 'application/json; charset=utf-8',
      // Content is immutable per build; the manifest is how you detect a new one.
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ error: 'not_found', path }));
  }
}).listen(PORT, () => console.log(`far: serving ${ROOT} on http://localhost:${PORT}`));
