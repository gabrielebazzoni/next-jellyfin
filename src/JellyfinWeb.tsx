import 'server-only';
import { createHash } from 'node:crypto';
import { Suspense, type CSSProperties } from 'react';
import { connection } from 'next/server';
import { resolveServerUrl } from './server-url.js';
import { getPluginTags, type InjectedTag } from './plugins.js';
import ClientFrame from './JellyfinFrame.js';

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

type Session = {
    serverUrl: string;
    serverId: string;
    serverName?: string;
    /** Missing when only the server is pre-selected (Jellyfin shows its login page for it). */
    accessToken?: string;
    userId?: string;
    /** DeviceId the token was issued to (unknown for tokens passed in via props). */
    deviceId?: string;
};

// ---------------------------------------------------------------------------------------------------
// Server-side login (with in-memory token cache)
// ---------------------------------------------------------------------------------------------------

const CLIENT = 'Jellyfin Web';
const REVALIDATE_MS = 5 * 60 * 1000;
const cache = new Map<string, { session: Session; checkedAt: number }>();
const pending = new Map<string, Promise<Session>>();

const authHeader = (deviceId: string, token?: string) =>
    `MediaBrowser Client="${CLIENT}", Device="Next.js", DeviceId="${deviceId}", Version="10.11.0"`
    + (token ? `, Token="${token}"` : '');

async function jellyfinFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, { cache: 'no-store', ...init });
    if (res.status === 401) throw new Error(`Jellyfin rejected the credentials (${url})`);
    if (!res.ok) throw new Error(`Jellyfin ${init.method ?? 'GET'} ${url}: HTTP ${res.status}`);
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
        throw new Error(`Jellyfin ${url} did not return JSON (redirected to ${res.url}): check serverUrl`);
    }
    return res.json() as Promise<T>;
}

async function login(
    serverUrl: string, serverName: string | undefined, username: string, password: string, deviceId: string
): Promise<Session> {
    const auth = await jellyfinFetch<{ AccessToken: string; ServerId: string; User: { Id: string } }>(
        `${serverUrl}/Users/AuthenticateByName`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader(deviceId) },
            body: JSON.stringify({ Username: username, Pw: password })
        }
    );
    return {
        serverUrl,
        serverId: auth.ServerId,
        serverName,
        accessToken: auth.AccessToken,
        userId: auth.User.Id,
        deviceId
    };
}

async function isValid(s: Session) {
    return fetch(`${s.serverUrl}/Users/Me`, {
        headers: { Authorization: authHeader(s.deviceId ?? 'nextjs', s.accessToken) },
        cache: 'no-store'
    }).then(r => r.ok, () => false);
}

async function getSession(
    serverUrl: string, serverName: string | undefined, username: string, password: string
): Promise<Session> {
    const key = `${serverUrl}|${username}`;
    const deviceId = `nextjs-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;

    const cached = cache.get(key);
    if (cached) {
        if (Date.now() - cached.checkedAt < REVALIDATE_MS) return cached.session;
        if (await isValid(cached.session)) {
            cached.checkedAt = Date.now();
            return cached.session;
        }
        cache.delete(key);
    }

    let job = pending.get(key);
    if (!job) {
        job = login(serverUrl, serverName, username, password, deviceId)
            .then(session => {
                cache.set(key, { session, checkedAt: Date.now() });
                return session;
            })
            .finally(() => pending.delete(key));
        pending.set(key, job);
    }
    return job;
}

// ---------------------------------------------------------------------------------------------------
// Browser-side bootstrap: writes the session the way jellyfin-apiclient's Credentials class does
// ---------------------------------------------------------------------------------------------------

function bootstrapScript(session: Session, target: string) {
    const server = {
        Id: session.serverId,
        Name: session.serverName || 'Jellyfin',
        ManualAddress: session.serverUrl,
        LastConnectionMode: 2, // ConnectionMode.Manual
        ...(session.accessToken ? { UserId: session.userId, AccessToken: session.accessToken } : {})
    };
    // `<` escaped so the JSON can never close the <script> tag
    const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
    return `
var K = 'jellyfin_credentials', server = ${json(server)}, stored = {};
try { stored = JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch (e) {}
server.DateLastAccessed = Date.now();
stored.Servers = [server].concat((stored.Servers || []).filter(function (s) { return s.Id !== server.Id; }));
localStorage.setItem(K, JSON.stringify(stored));
${session.deviceId ? `localStorage.setItem('_deviceId2', ${json(session.deviceId)});` : ''}
location.replace(${json(target)});`;
}

// ---------------------------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------------------------

async function JellyfinFrame(props: JellyfinWebProps) {
    const {
        username, password = '', accessToken, userId, route,
        basePath = '/jellyfin', className, style, title = 'Jellyfin'
    } = props;
    const serverUrl = props.serverUrl?.replace(/\/+$/, '');
    const hash = route ? `#${route.startsWith('/') ? route : `/${route}`}` : '';
    const src = `${basePath.replace(/\/+$/, '')}/index.html${hash}`;

    let session: Session | undefined;
    let inject: InjectedTag[] = [];
    if (serverUrl) {
        await connection(); // talk to Jellyfin at request time, never at build time
        try {
            const { url, info } = await resolveServerUrl(serverUrl);
            // Without credentials (or if login fails) the server is still pre-selected on Jellyfin's login page.
            session = { serverUrl: url, serverId: info.Id, serverName: info.ServerName };
            inject = await getPluginTags(url); // scripts/styles that server plugins add to Jellyfin's web client
            if (accessToken && userId) {
                session = { ...session, accessToken, userId };
            } else if (username) {
                session = await getSession(url, info.ServerName, username, password).catch(error => {
                    console.error(`[next-jellyfin] login as "${username}" failed: ${(error as Error).message}`);
                    return session;
                });
            }
        } catch (error) {
            console.error(`[next-jellyfin] ${(error as Error).message}`);
        }
    }

    return (
        <ClientFrame
            // A new key per token reloads the frame (and re-injects) when the session changes.
            key={session ? `${session.serverId}:${session.accessToken ?? ''}` : 'anonymous'}
            src={session ? undefined : src}
            srcDoc={session ? `<!doctype html><script>${bootstrapScript(session, src)}</script>` : undefined}
            inject={inject}
            title={title}
            className={className}
            style={style}
        />
    );
}

export default function JellyfinWeb(props: JellyfinWebProps) {
    return (
        <Suspense>
            <JellyfinFrame {...props} />
        </Suspense>
    );
}
