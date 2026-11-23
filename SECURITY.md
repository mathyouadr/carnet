# Security

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → *Report a vulnerability*) rather than a public
issue. You will get an answer within a week.

## How Carnet protects your notes

- **Password mode** (`CARNET_PASSWORD`): signed `HttpOnly`, `SameSite=Strict` session cookie (add
  `CARNET_SECURE_COOKIE=1` behind HTTPS); changing the password logs every session out; 8 failed logins per address
  = 5 minutes wait.
- **API tokens** for scripts (`Authorization: Bearer …`), compared in constant time.
- **No password** (trusted network only): Carnet still refuses what another web site could make your browser do —
  cross-site writes (CSRF: non-JSON bodies, foreign `Origin`, `Sec-Fetch-Site: cross-site`; uploads need a custom
  header that forms cannot send) and unknown host names (DNS rebinding, see `CARNET_ALLOWED_HOSTS`). Anyone who can
  reach the port can still read and change your notes: set a password as soon as the network is not entirely yours.
- **Uploaded files** are served from their own path with `Content-Security-Policy: sandbox`; anything that is not a
  plain image, PDF, audio or video file (HTML, SVG…) is sent as a download, never rendered as part of the site.
- **Imports** refuse absolute paths, `..` and zip bombs.
- Page content is rendered by the editor (ProseMirror), never injected as HTML; embeds run in sandboxed iframes.
- SQL queries are parameterised; the database and uploads are readable by their owner only (`umask 077`).
- `X-Frame-Options`, `Content-Security-Policy: frame-ancestors 'self'`, `nosniff`, `Referrer-Policy: same-origin`.
- The server has no third-party dependency: the Python standard library and SQLite.
