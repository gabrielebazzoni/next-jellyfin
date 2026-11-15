#!/usr/bin/env node
/**
 * next-jellyfin CLI — run it from your Next.js project folder.
 *
 *   npx next-jellyfin sync                 # "auto" if JELLYFIN_SERVER_URL is set, otherwise "latest"
 *   npx next-jellyfin sync auto            # same version as your Jellyfin server (reads /System/Info/Public)
 *   npx next-jellyfin sync latest          # latest stable release
 *   npx next-jellyfin sync 10.11.11        # a specific version
 *   npx next-jellyfin sync ./path/dist     # a local build of jellyfin-web
 *   npx next-jellyfin sync proxy           # no copy: withJellyfin() in next.config proxies /jellyfin to <server>/web
 *
 * Official builds are downloaded from repo.jellyfin.org (Debian "jellyfin-web" package, ~30 MB, platform
 * independent). Versions no longer on the repo are built from the GitHub tag instead (needs git + npm).
 *
 * Env (also read from .env.local / .env): JELLYFIN_SERVER_URL, JELLYFIN_BASE_PATH (default "jellyfin"),
 * JELLYFIN_MULTISERVER ("true").
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveServerUrl } from '../dist/server-url.js';

const REPO = 'https://repo.jellyfin.org/files/server/debian';
const GIT = 'https://github.com/jellyfin/jellyfin-web.git';

const USAGE = `Usage: next-jellyfin sync [auto|latest|<version>|<path to a jellyfin-web build>|proxy]

Run it from the root of your Next.js project. See https://github.com/gabrielebazzoni/next-jellyfin`;

const [command, target] = process.argv.slice(2);
if (command !== 'sync') {
    console.log(USAGE);
    process.exit(command === undefined || command === '--help' || command === '-h' ? 0 : 1);
}

const root = process.cwd();
for (const file of ['.env.local', '.env']) {
    if (existsSync(path.join(root, file))) process.loadEnvFile(path.join(root, file)); // never overrides real env vars
}
if (!existsSync(path.join(root, 'package.json'))) {
    console.error(`[jellyfin] no package.json in ${root}: run this from your Next.js project folder`);
    process.exit(1);
}

const dest = path.join(root, 'public', process.env.JELLYFIN_BASE_PATH ?? 'jellyfin');
let serverUrl = process.env.JELLYFIN_SERVER_URL?.replace(/\/+$/, '');
const arg = target ?? (serverUrl ? 'auto' : 'latest');

const log = msg => console.log(`[jellyfin] ${msg}`);
const fail = msg => {
    console.error(`[jellyfin] ${msg}`);
    process.exit(1);
};

async function listing(url) {
    const res = await fetch(url);
    if (!res.ok) return [];
    const html = await res.text();
    return [...html.matchAll(/href="([^"?/][^"]*)"/g)].map(m => decodeURIComponent(m[1]));
}

async function serverVersion() {
    if (!serverUrl) fail('"auto" needs JELLYFIN_SERVER_URL');
    const { url, info } = await resolveServerUrl(serverUrl).catch(e => fail(e.message));
    if (url !== serverUrl) log(`server uses a Base URL: ${url} (consider setting JELLYFIN_SERVER_URL=${url})`);
    serverUrl = url;
    log(`server ${serverUrl} is version ${info.Version}`);
    return info.Version;
}

/** Finds the jellyfin-web .deb URL for a version ("latest" or e.g. 10.11.11 / 12.4 / 12.4.0). */
async function findDeb(version) {
    let dir;
    if (version === 'latest') {
        dir = `${REPO}/latest-stable/amd64/`;
    } else {
        const folders = await listing(`${REPO}/stable/`);
        const candidates = [`v${version}`, `v${version.replace(/(\.0)+$/, '')}`];
        const folder = candidates.find(c => folders.includes(`${c}/`));
        if (!folder) return undefined;
        dir = `${REPO}/stable/${folder}/amd64/`;
    }
    const debs = (await listing(dir)).filter(f => /^jellyfin-web_.*_all\.deb$/.test(f)).sort();
    return debs.length ? { url: dir + encodeURIComponent(debs.at(-1)), name: debs.at(-1) } : undefined;
}

/** Extracts `data.tar.*` from a .deb (ar archive) and returns the jellyfin-web folder inside it. */
function extractDeb(buf, tmp) {
    if (buf.toString('latin1', 0, 8) !== '!<arch>\n') fail('downloaded file is not a .deb');
    for (let off = 8; off + 60 <= buf.length;) {
        const name = buf.toString('latin1', off, off + 16).trim().replace(/\/$/, '');
        const size = parseInt(buf.toString('latin1', off + 48, off + 58).trim(), 10);
        const start = off + 60;
        if (name.startsWith('data.tar')) {
            const tarPath = path.join(tmp, name);
            return writeFile(tarPath, buf.subarray(start, start + size)).then(() => {
                execFileSync('tar', ['-xf', tarPath, '-C', tmp], { stdio: 'inherit' });
                return path.join(tmp, 'usr', 'share', 'jellyfin', 'web');
            });
        }
        off = start + size + (size % 2);
    }
    fail('data archive not found in .deb');
}

async function fromRepo(deb, tmp) {
    log(`downloading ${deb.name}`);
    const res = await fetch(deb.url);
    if (!res.ok) fail(`download failed: HTTP ${res.status}`);
    return extractDeb(Buffer.from(await res.arrayBuffer()), tmp);
}

function fromSource(version, tmp) {
    const tag = `v${version}`;
    log(`${version} is not on repo.jellyfin.org anymore: building ${tag} from GitHub (takes a few minutes)`);
    const src = path.join(tmp, 'jellyfin-web');
    const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    try {
        run('git', ['clone', '--depth', '1', '--branch', tag, GIT, src]);
    } catch {
        fail(`version ${version} not found (no tag ${tag} on ${GIT})`);
    }
    run('npm', ['ci', '--no-audit', '--no-fund'], src);
    run('npm', ['run', 'build:production'], src);
    return path.join(src, 'dist');
}

async function install(webDir, label) {
    if (!existsSync(path.join(webDir, 'index.html'))) fail(`no index.html in ${webDir}`);
    await rm(dest, { recursive: true, force: true });
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(webDir, dest, { recursive: true });

    const configPath = path.join(dest, 'config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const url = serverUrl && (await resolveServerUrl(serverUrl).then(r => r.url, () => serverUrl));
    config.servers = url ? [url] : [];
    config.multiserver = process.env.JELLYFIN_MULTISERVER === 'true' || !serverUrl;
    await writeFile(configPath, JSON.stringify(config, null, 4));
    await writeFile(path.join(dest, 'jellyfin-web-version.txt'), `${label}\n`);
    log(`jellyfin-web ${label} installed in ${path.relative(root, dest)}`);
}

// ---------------------------------------------------------------------------------------------------

if (arg === 'proxy') {
    if (!serverUrl) fail('"proxy" needs JELLYFIN_SERVER_URL (also when running next build / next start)');
    await rm(dest, { recursive: true, force: true });
    log(`proxy mode: removed ${path.relative(root, dest)}; /jellyfin/* is now served by ${serverUrl}/web/* (needs withJellyfin() in next.config)`);
    process.exit(0);
}

const local = path.resolve(root, arg);
if (existsSync(local)) {
    await install(local, `local build (${arg})`);
    process.exit(0);
}

const version = arg === 'auto' ? await serverVersion() : arg;
const tmp = await mkdtemp(path.join(os.tmpdir(), 'jellyfin-web-'));
try {
    const deb = await findDeb(version);
    if (deb) {
        await install(await fromRepo(deb, tmp), deb.name.replace(/^jellyfin-web_|_all\.deb$/g, ''));
    } else if (version === 'latest') {
        fail('cannot find the latest release on repo.jellyfin.org');
    } else {
        await install(fromSource(version, tmp), `${version} (built from source)`);
    }
} finally {
    await rm(tmp, { recursive: true, force: true });
}
