/**
 * Server plugins such as InPlayerEpisodePreview, JavaScript Injector or File Transformation add <script>, <link>
 * and <style> tags to the index.html served by Jellyfin (`<server>/web/index.html`). The copy in
 * `public/jellyfin` doesn't have them, and in proxy mode their URLs point to the Next.js site instead of Jellyfin.
 *
 * This reads the server's index.html, keeps only what plugins added, and makes every URL absolute to the server,
 * so the tags can be injected into the client by <JellyfinFrame>.
 */
const TTL_MS = 60 * 1000;
const cache = new Map();
// Files that belong to jellyfin-web itself (relative to /web/): never re-inject them.
const OWN_FILE = /^(?!\.\.\/|\/|[a-z]+:)[^?#]*(\.bundle\.js|\.chunk\.js|serviceworker\.js|\.css|manifest\.json|\.(png|ico|svg))(\?|#|$)/i;
function parseAttrs(raw) {
    const attrs = {};
    for (const m of raw.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    return attrs;
}
export function extractPluginTags(html, webIndexUrl) {
    const tags = [];
    const absolute = (url) => {
        try {
            return new URL(url, webIndexUrl).href;
        }
        catch {
            return url;
        }
    };
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>|<style\b([^>]*)>([\s\S]*?)<\/style>|<link\b([^>]*?)\/?>/gi;
    for (const m of html.matchAll(re)) {
        if (m[0].toLowerCase().startsWith('<script')) {
            const attrs = parseAttrs(m[1]);
            if (attrs.type && !/javascript|module/i.test(attrs.type))
                continue; // JSON, templates, ...
            if (attrs.src) {
                if (OWN_FILE.test(attrs.src))
                    continue;
                attrs.src = absolute(attrs.src);
                tags.push({ tag: 'script', attrs });
            }
            else if (m[2].trim()) {
                tags.push({ tag: 'script', attrs, text: m[2] });
            }
        }
        else if (m[0].toLowerCase().startsWith('<style')) {
            if (m[4].trim())
                tags.push({ tag: 'style', attrs: parseAttrs(m[3]), text: m[4] });
        }
        else {
            const attrs = parseAttrs(m[5]);
            if (!/stylesheet/i.test(attrs.rel ?? '') || !attrs.href || OWN_FILE.test(attrs.href))
                continue;
            attrs.href = absolute(attrs.href);
            tags.push({ tag: 'link', attrs });
        }
    }
    return tags;
}
/** Plugin tags of a (resolved) Jellyfin server. Never throws: on errors it returns no tags. */
export async function getPluginTags(serverUrl) {
    const cached = cache.get(serverUrl);
    if (cached && Date.now() - cached.at < TTL_MS)
        return cached.tags;
    const webIndexUrl = `${serverUrl}/web/index.html`;
    try {
        const res = await fetch(webIndexUrl, { cache: 'no-store' });
        const tags = res.ok ? extractPluginTags(await res.text(), res.url || webIndexUrl) : [];
        cache.set(serverUrl, { tags, at: Date.now() });
        return tags;
    }
    catch {
        return cached?.tags ?? [];
    }
}
