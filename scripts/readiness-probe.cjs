async function isReady(fetchImpl = globalThis.fetch, port = process.env.PORT || '3000') {
  if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) return false;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) return false;
    const body = await response.json();
    return body.status === 'ok' && body.db === 'connected';
  } catch { return false; }
}
module.exports = { isReady };
if (require.main === module) isReady().then(ready => { process.exitCode = ready ? 0 : 1; });
