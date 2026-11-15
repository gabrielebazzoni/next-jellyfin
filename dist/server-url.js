/**
 * Resolves the real API root of a Jellyfin server.
 *
 * Jellyfin can run under a "Base URL" (Dashboard → Networking), e.g. `https://host/media-server`. If the user passes
 * only `https://host`, `/System/Info/Public` is redirected to the web UI (`<base>/web/`) instead of returning JSON,
 * and the browser fails with CORS errors. This follows that redirect and returns `https://host/media-server`.
 */
export class JellyfinServerError extends Error {
}
const resolved = new Map();
async function tryInfo(base) {
    const res = await fetch(`${base}/System/Info/Public`, { cache: 'no-store', redirect: 'follow' });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        const info = (await res.json());
        if (info?.Id)
            return { info };
    }
    return { finalUrl: res.url };
}
export async function resolveServerUrl(serverUrl) {
    const input = serverUrl.trim().replace(/\/+$/, '').replace(/\/web(\/.*)?$/i, '');
    const known = resolved.get(input);
    if (known) {
        const { info } = await tryInfo(known);
        if (info)
            return { url: known, info };
    }
    let first;
    try {
        first = await tryInfo(input);
    }
    catch (e) {
        throw new JellyfinServerError(`Cannot reach Jellyfin at ${input}: ${e.message}`);
    }
    if (first.info) {
        resolved.set(input, input);
        return { url: input, info: first.info };
    }
    // Redirected to "<base>/web/..." → the server uses a Base URL.
    const match = first.finalUrl?.match(/^(.*?)\/web(\/|$)/i);
    if (match && match[1] !== input) {
        const base = match[1].replace(/\/+$/, '');
        const second = await tryInfo(base).catch(() => ({ info: undefined }));
        if (second.info) {
            resolved.set(input, base);
            return { url: base, info: second.info };
        }
    }
    throw new JellyfinServerError(`No Jellyfin API found at ${input}. If your server has a Base URL (Dashboard → Networking), ` +
        'include it in serverUrl, e.g. https://example.com/jellyfin');
}
