# GitHub Pages Setup (PWA Canopy)

GitHub Pages can host only the canopy UI. The Cordyceps server core and node agents still run on your own host.

## 1. Server-side CORS

Default build already allows:

- `https://pclaystation.github.io`
- `https://mpmc.ddns.net`

Only set `CORS_ALLOWED_ORIGINS` if you use different domains.

## 2. Deploy PWA to Pages

This repo includes workflow:

- `.github/workflows/deploy-pages.yml`

In GitHub Settings -> Pages:

- Source: `GitHub Actions`

Push to `main` and wait for workflow to deploy.

## 3. Open the canopy web app

Project Pages URL pattern:

- `https://<your-github-username>.github.io/<repo-name>/`

Inside the app:

- Set `API base URL` to your server origin, for example `https://mpmc.ddns.net`
- Paste `PHONE_API_TOKEN`
- Tap `Load Devices`
- Use `Agent Update` section when you want to push a new agent binary

Tip:

- Run `npm run show-config` on the server and use `external_pwa_pairing_url` once. It auto-fills API base and token.

## 4. Install as app

On iPhone Safari:

- Share -> Add to Home Screen

## Notes

- Do not include `:8080` when using `https://...`
- If CORS blocks requests, verify `CORS_ALLOWED_ORIGINS` exactly matches the Pages origin
