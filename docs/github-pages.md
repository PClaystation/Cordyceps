# GitHub Pages Setup (PWA Client)

GitHub Pages can host only the client UI. The Jarvis server and agent still run on your own host.

## 1. Server-side CORS

Set this on your server before restart:

```bash
export CORS_ALLOWED_ORIGINS="https://<your-github-username>.github.io"
```

If you use a custom Pages domain, use that domain origin instead.

## 2. Deploy PWA to Pages

This repo includes workflow:

- `.github/workflows/deploy-pages.yml`

In GitHub Settings -> Pages:

- Source: `GitHub Actions`

Push to `main` and wait for workflow to deploy.

## 3. Open the web app

Project Pages URL pattern:

- `https://<your-github-username>.github.io/<repo-name>/`

Inside the app:

- Set `API base URL` to your server origin, for example `https://mpmc.ddns.net`
- Paste `PHONE_API_TOKEN`
- Tap `Load Devices`

## 4. Install as app

On iPhone Safari:

- Share -> Add to Home Screen

## Notes

- Do not include `:8080` when using `https://...`
- If CORS blocks requests, verify `CORS_ALLOWED_ORIGINS` exactly matches the Pages origin
