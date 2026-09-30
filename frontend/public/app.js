// Placeholder frontend script. External (not inline) so it satisfies the
// backend's production CSP, which only allows `script-src 'self'`.
// Calls /health to prove the API and SPA fallback are both working.
(async () => {
  const el = document.getElementById("status");
  if (!el) return;
  try {
    const res = await fetch("/health");
    const body = await res.json();
    el.textContent = `API: ${body.status}`;
    el.className = "ok";
  } catch {
    el.textContent = "API unreachable";
    el.className = "bad";
  }
})();
