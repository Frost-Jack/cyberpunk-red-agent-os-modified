// Optional live check: reads a few audio packets and closes each connection.
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../scripts/apps/radio.js', import.meta.url), 'utf8');
const slugs = [...source.matchAll(/\{ slug: "([a-z]+)"/g)].map(m => m[1]);
async function check(url, expected) {
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(url, { signal: abort.signal });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !(type.includes(expected) || (expected === 'audio/' && type.includes('application/ogg')))) throw new Error(`HTTP ${response.status}, ${type}`);
    const reader = response.body.getReader(), chunk = await reader.read();
    if (!chunk.value?.length) throw new Error('Empty response');
    if (expected === 'audio/' && Buffer.from(chunk.value.subarray(0, 4)).toString() !== 'OggS') throw new Error('Missing Ogg stream header');
    let bytes = chunk.value.length;
    while (expected === 'audio/' && bytes < 4096) {
      const next = await reader.read();
      if (next.done) throw new Error('Audio stream ended after its header');
      bytes += next.value.length;
    }
    await reader.cancel();
    return { url, status: response.status, type: response.headers.get('content-type'), bytes, ok: true };
  } catch (error) { return { url, ok: false, error: error.message }; }
  finally { clearTimeout(timeout); abort.abort(); }
}
const results = [];
for (let i = 0; i < slugs.length; i += 3) results.push(...await Promise.all(slugs.slice(i, i + 3).map(s => check(`https://stream.nightride.fm/${s}.ogg`, 'audio/'))));
results.push(await check('https://nightride.fm/meta', 'text/event-stream'));
for (const result of results) console.log(JSON.stringify(result));
if (results.some(r => !r.ok)) process.exitCode = 1;
