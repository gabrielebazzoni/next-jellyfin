import 'server-only';
import { type CSSProperties } from 'react';
/**
 * <JellyfinWeb /> — the full Jellyfin web client (jellyfin-web, installed with `npx next-jellyfin sync`) as a
 * Next.js Server Component, with optional automatic login.
 *
 *   <JellyfinWeb serverUrl="http://192.168.1.10:8096" username="mario" password="..." />
 *
 * How it works:
 * - The login runs here, on the Next.js server: the password never reaches the browser.
 * - The iframe first loads a tiny same-origin bootstrap document (`srcDoc`) that writes the access
 *   token into jellyfin-web's storage (`localStorage.jellyfin_credentials`) and then navigates to the
 *   real client, which starts already signed in. No client-side React code is needed.
 * - Tokens are cached in memory and reused; the DeviceId is stable per server+user, so Jellyfin keeps
 *   a single session instead of creating a new one on every page view.
 *
 * WARNING: whoever can open the page is signed in as that user, and the token is readable in the
 * browser. Protect the page with your own auth and don't use an administrator account.
 */
export type JellyfinWebProps = {
    /** Jellyfin server URL, e.g. `http://192.168.1.10:8096`. Required for automatic login. */
    serverUrl?: string;
    /** Jellyfin user for automatic login. Without it, Jellyfin shows its own login page. */
    username?: string;
    password?: string;
    /** Alternative to username/password: an existing access token (+ its user id). */
    accessToken?: string;
    userId?: string;
    /** Initial route, e.g. `/home`, `/movies`, `/details?id=...`. */
    route?: string;
    /** Folder under `public/` holding the jellyfin-web build (default: `/jellyfin`). */
    basePath?: string;
    className?: string;
    style?: CSSProperties;
    title?: string;
};
export default function JellyfinWeb(props: JellyfinWebProps): import("react").JSX.Element;
