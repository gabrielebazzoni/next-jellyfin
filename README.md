# next-jellyfin

The full [Jellyfin](https://jellyfin.org) web client as a single Next.js component, with **server-side auto-login**
and **easy version selection**.

```tsx
import JellyfinWeb from 'next-jellyfin';

export default function Page() {
    return (
        <main style={{ height: '100vh' }}>
            <JellyfinWeb serverUrl="http://192.168.1.10:8096" username="mario" password={process.env.JELLYFIN_PASSWORD} />
        </main>
    );
}
```

Everything Jellyfin does keeps working, because this *is* the official client: libraries, video/audio/book players,
SyncPlay, Chromecast, the admin dashboard, themes and plugins.

## Install

```bash
npm install github:gabrielebazzoni/next-jellyfin
npx next-jellyfin sync
```

`sync` downloads the official jellyfin-web build into `public/jellyfin`. Add that folder to `.gitignore`:

```bash
echo "/public/jellyfin" >> .gitignore
```

Requirements: Next.js ≥ 15 (App Router), React ≥ 19, Node ≥ 20.12. `sync` uses `tar` with `xz` support
(standard on Linux and macOS).

## Choosing the Jellyfin version

The web client must match your Jellyfin server version.

```bash
npx next-jellyfin sync auto       # same version as your server (default when JELLYFIN_SERVER_URL is set)
npx next-jellyfin sync latest     # latest stable (default otherwise)
npx next-jellyfin sync 10.11.11   # a specific version
npx next-jellyfin sync ./dist     # your own jellyfin-web build
npx next-jellyfin sync proxy      # no copy: use the client hosted by your server (see below)
```

- Official builds come from `repo.jellyfin.org` (the `jellyfin-web` package, ~30 MB).
- Versions no longer on the repository are built from the GitHub tag `v<version>` (needs `git` and `npm`, takes a few minutes).
- The installed version is in `public/jellyfin/jellyfin-web-version.txt`.
- `.env.local` and `.env` are read automatically.

To refresh it on every install, add it to your scripts:

```json
"scripts": {
  "postinstall": "next-jellyfin sync"
}
```

### Proxy mode (recommended when Next.js can reach Jellyfin)

```ts
// next.config.ts
import { withJellyfin } from 'next-jellyfin/config';

export default withJellyfin({
    // your Next.js config
});
```

```bash
npx next-jellyfin sync proxy   # removes public/jellyfin
```

`/jellyfin/*` is then served from `<JELLYFIN_SERVER_URL>/web/*`:

- the client always matches your server, with no re-download after server updates;
- plugins that modify the web UI work too (see below).

`JELLYFIN_SERVER_URL` must also be set during `next build`. `withJellyfin(config, { serverUrl, basePath })` accepts
explicit options as well. A copy in `public/jellyfin` always takes precedence over the proxy.

## Base URL

If your Jellyfin has a **Base URL** (Dashboard → Networking, e.g. `/media-server`), it is detected automatically:
`https://example.com` becomes `https://example.com/media-server`. Setting the full URL in `serverUrl` /
`JELLYFIN_SERVER_URL` saves one request at startup.

## Troubleshooting

- **"Connection Failure" or CORS errors in the browser console**: `serverUrl` doesn't point to the Jellyfin API.
  Open `<serverUrl>/System/Info/Public`: it must return JSON. Check the Base URL (see above).
- **Login problems** are logged on the Next.js server console as `[next-jellyfin] ...`. When the login fails,
  Jellyfin's own login page is shown for that server.

## Props

| Prop | Type | Description |
|---|---|---|
| `serverUrl` | `string` | Jellyfin server URL (Base URL detected automatically). Needed for auto-login; on its own it pre-selects the server on Jellyfin's login page. |
| `username`, `password` | `string` | Jellyfin user for auto-login. Without them, Jellyfin's own login page is shown. |
| `accessToken`, `userId` | `string` | Instead of username/password: an existing access token. |
| `route` | `string` | Initial route, e.g. `/home`, `/movies`, `/details?id=…`. |
| `basePath` | `string` | Where the client is served, default `/jellyfin`. |
| `className`, `style`, `title` | | Passed to the iframe (100% × 100% of its container by default). |

`JellyfinWeb` is a **Server Component**: use it in pages, layouts or other server components, not in `'use client'` files.

## How it works

- The client is shown in a same-origin `<iframe>` served from `public/jellyfin` (or proxied from your server).
- With credentials, the component logs in **on the Next.js server**: the password never reaches the browser.
  The iframe first loads a tiny bootstrap document that stores the access token where jellyfin-web expects it
  (`localStorage.jellyfin_credentials`), then opens the client already signed in.
- Tokens are cached in memory and reused. The DeviceId is stable per server and user, so Jellyfin keeps a single
  session instead of a new one on every page view.

> ⚠️ Anyone who can open the page is signed in as that user, and the token is readable in the browser.
> Protect the page with your own authentication and don't use an administrator account.

## Plugins

| Kind | Works? |
|---|---|
| Client plugins built into jellyfin-web (players, SyncPlay, Chromecast, screensavers, …) | ✅ always |
| Server plugins (dashboard configuration pages, metadata, subtitles, auth, …) | ✅ always, pages come from the server API |
| Plugins that inject scripts/CSS into the server's web client (JavaScript Injector, File Transformation and plugins based on it, such as Jellyfin Enhanced, Home Screen Sections, Custom Tabs) | ✅ in **proxy mode** only |

Custom CSS from Dashboard → General → Branding always works.

## Notes

- Your Jellyfin server must accept requests from your site's origin (CORS). Jellyfin does by default; make sure a
  reverse proxy in front of it doesn't strip the CORS headers.
- This package is MIT licensed. jellyfin-web, which `sync` downloads, is GPL-2.0-or-later.
