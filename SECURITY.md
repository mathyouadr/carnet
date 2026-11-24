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
- Page content is rendered by the editor (ProseMirror); the few HTML previews (page history, AI answer) escape every
  value. Links and URL properties only open `http(s)`, `mailto` and `tel`; embeds only load web pages and uploaded
  files, in sandboxed iframes.
- The web page sends `Content-Security-Policy: script-src 'self' 'nonce-…'`: only Carnet's own scripts (and the
  `<script>` tags of `CARNET_EXTRA_HEAD` / `CARNET_EXTRA_BODY`, which get the nonce) can run, so injected HTML can't.
- SQL queries are parameterised; the data folder, the database and uploads are readable by their owner only
  (`umask 077`, folder in `700`). Uploads and imports are streamed to disk, not held in memory.
- `X-Frame-Options`, `Content-Security-Policy: frame-ancestors 'self'`, `nosniff`, `Referrer-Policy: same-origin`.
- The server has no third-party dependency: the Python standard library and SQLite.
