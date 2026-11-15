import { jsx as _jsx } from "react/jsx-runtime";
import 'server-only';
import { createHash } from 'node:crypto';
import { Suspense } from 'react';
import { connection } from 'next/server';
import { resolveServerUrl } from './server-url.js';
// ---------------------------------------------------------------------------------------------------
// Server-side login (with in-memory token cache)
// ---------------------------------------------------------------------------------------------------
const CLIENT = 'Jellyfin Web';
const REVALIDATE_MS = 5 * 60 * 1000;
const cache = new Map();
const pending = new Map();
const authHeader = (deviceId, token) => `MediaBrowser Client="${CLIENT}", Device="Next.js", DeviceId="${deviceId}", Version="10.11.0"`
    + (token ? `, Token="${token}"` : '');
async function jellyfinFetch(url, init = {}) {
    const res = await fetch(url, { cache: 'no-store', ...init });
    if (res.status === 401)
        throw new Error(`Jellyfin rejected the credentials (${url})`);
    if (!res.ok)
        throw new Error(`Jellyfin ${init.method ?? 'GET'} ${url}: HTTP ${res.status}`);
    if (!(res.headers.get('content-type') ?? '').includes('json')) {
        throw new Error(`Jellyfin ${url} did not return JSON (redirected to ${res.url}): check serverUrl`);
    }
    return res.json();
}
async function login(serverUrl, serverName, username, password, deviceId) {
    const auth = await jellyfinFetch(`${serverUrl}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader(deviceId) },
        body: JSON.stringify({ Username: username, Pw: password })
    });
    return {
        serverUrl,
        serverId: auth.ServerId,
        serverName,
        accessToken: auth.AccessToken,
        userId: auth.User.Id,
        deviceId
    };
}
async function isValid(s) {
    return fetch(`${s.serverUrl}/Users/Me`, {
        headers: { Authorization: authHeader(s.deviceId ?? 'nextjs', s.accessToken) },
        cache: 'no-store'
    }).then(r => r.ok, () => false);
}
async function getSession(serverUrl, serverName, username, password) {
    const key = `${serverUrl}|${username}`;
    const deviceId = `nextjs-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
    const cached = cache.get(key);
    if (cached) {
        if (Date.now() - cached.checkedAt < REVALIDATE_MS)
            return cached.session;
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
function bootstrapScript(session, target) {
    const server = {
        Id: session.serverId,
        Name: session.serverName || 'Jellyfin',
        ManualAddress: session.serverUrl,
        LastConnectionMode: 2, // ConnectionMode.Manual
        ...(session.accessToken ? { UserId: session.userId, AccessToken: session.accessToken } : {})
    };
    // `<` escaped so the JSON can never close the <script> tag
    const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
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
async function JellyfinFrame(props) {
    const { username, password = '', accessToken, userId, route, basePath = '/jellyfin', className, style, title = 'Jellyfin' } = props;
    const serverUrl = props.serverUrl?.replace(/\/+$/, '');
    const hash = route ? `#${route.startsWith('/') ? route : `/${route}`}` : '';
    const src = `${basePath.replace(/\/+$/, '')}/index.html${hash}`;
    let session;
    if (serverUrl) {
        await connection(); // talk to Jellyfin at request time, never at build time
        try {
            const { url, info } = await resolveServerUrl(serverUrl);
            // Without credentials (or if login fails) the server is still pre-selected on Jellyfin's login page.
            session = { serverUrl: url, serverId: info.Id, serverName: info.ServerName };
            if (accessToken && userId) {
                session = { ...session, accessToken, userId };
            }
            else if (username) {
                session = await getSession(url, info.ServerName, username, password).catch(error => {
                    console.error(`[next-jellyfin] login as "${username}" failed: ${error.message}`);
                    return session;
                });
            }
        }
        catch (error) {
            console.error(`[next-jellyfin] ${error.message}`);
        }
    }
    return (_jsx("iframe", { src: session ? undefined : src, srcDoc: session ? `<!doctype html><script>${bootstrapScript(session, src)}</script>` : undefined, title: title, className: className, style: { border: 0, width: '100%', height: '100%', display: 'block', ...style }, allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media', allowFullScreen: true }, session ? `${session.serverId}:${session.accessToken ?? ''}` : 'anonymous'));
}
export default function JellyfinWeb(props) {
    return (_jsx(Suspense, { children: _jsx(JellyfinFrame, { ...props }) }));
}
