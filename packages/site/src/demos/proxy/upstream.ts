// A tiny in-process upstream so the reverse-proxy demo is self-contained: it
// echoes back the path and query it received, which makes the prefix-stripping
// of Mochi.proxy() visible. Started once at module load on an ephemeral port.
const upstream = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    return Response.json({
      upstreamReceived: url.pathname,
      query: url.search || '(none)',
      via: req.headers.get('host'),
    });
  },
});

export const upstreamOrigin = `http://127.0.0.1:${upstream.port}`;
