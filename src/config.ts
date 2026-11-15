import type { NextConfig } from 'next';
import { resolveServerUrl } from './server-url.js';

type Rewrite = { source: string; destination: string };
type Rewrites = Awaited<ReturnType<NonNullable<NextConfig['rewrites']>>>;

export type WithJellyfinOptions = {
    /** Jellyfin server; default: env JELLYFIN_SERVER_URL. Without it, proxy mode is off. */
    serverUrl?: string;
    /** Same as the component's `basePath` (default: `/jellyfin`). */
    basePath?: string;
};

/**
 * Enables "proxy" mode: `/jellyfin/*` is served from `<serverUrl>/web/*`, so the web client always matches
 * your server version and server-side web plugins (JavaScript Injector, File Transformation, ...) work.
 *
 * It is a `fallback` rewrite: a copy installed in `public/jellyfin` (`npx next-jellyfin sync`) always wins.
 *
 *   // next.config.ts
 *   import { withJellyfin } from 'next-jellyfin/config';
 *   export default withJellyfin({ ...yourConfig });
 */
export function withJellyfin(config: NextConfig = {}, options: WithJellyfinOptions = {}): NextConfig {
    const serverUrl = (options.serverUrl ?? process.env.JELLYFIN_SERVER_URL)?.replace(/\/+$/, '');
    if (!serverUrl) return config;

    const base = `/${(options.basePath ?? '/jellyfin').replace(/^\/+|\/+$/g, '')}`;

    return {
        ...config,
        async rewrites() {
            // Picks up the server's Base URL (e.g. /media-server) if serverUrl doesn't include it.
            const target = await resolveServerUrl(serverUrl).then(r => r.url, () => serverUrl);
            const proxy: Rewrite = { source: `${base}/:path*`, destination: `${target}/web/:path*` };
            const existing: Rewrites = (await config.rewrites?.()) ?? [];
            if (Array.isArray(existing)) {
                // a plain array means "afterFiles"
                return { beforeFiles: [], afterFiles: existing, fallback: [proxy] };
            }
            return {
                beforeFiles: existing.beforeFiles ?? [],
                afterFiles: existing.afterFiles ?? [],
                fallback: [...(existing.fallback ?? []), proxy]
            };
        }
    };
}

export default withJellyfin;
