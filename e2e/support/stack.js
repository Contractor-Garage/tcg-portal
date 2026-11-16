/**
 * Starts (and later stops) the local stack the browser tests run against:
 *   1. a throwaway MongoDB on port 27099 (data in the OS temp folder),
 *   2. the TCG server on port 3005, pointed ONLY at that database,
 *   3. the portal dev server on port 3000 (in dev mode it talks to localhost:3005).
 * Anything already running on those ports is reused, so the slow portal compile can be kept
 * running between test runs. Nothing here can reach the production database.
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const PORTAL_DIR = path.resolve(__dirname, '..', '..');
const TCG_DIR = process.env.TCG_DIR || path.resolve(PORTAL_DIR, '..', 'TCG');
const MONGOD_PATH = process.env.MONGOD_PATH || 'C:\\Program Files\\MongoDB\\Server\\4.2\\bin\\mongod.exe';
const DB_URI = 'mongodb://127.0.0.1:27099/tcg_e2e';
const PIDS_FILE = path.join(os.tmpdir(), 'tcg-e2e-pids.json');
const REAL_CLOUDINARY = process.env.E2E_REAL_CLOUDINARY === '1';

const isListening = (port) => new Promise(resolve => {
    const sock = net.connect(port, '127.0.0.1');
    sock.once('connect', () => { sock.end(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
});

const waitFor = async (check, what, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Timed out waiting for ${what}`);
};

const httpOk = (url) => async () => {
    try { return (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok; } catch (e) { return false; }
};

/** Only the Cloudinary keys are read from TCG/.env, and only in real-Cloudinary mode. */
const cloudinaryEnv = () => {
    if (!REAL_CLOUDINARY) {
        return { API_KEY: 'e2e-fake', API_SECRET: 'e2e-fake', CLOUD_NAME: 'e2e-fake-cloud', UPLOAD_PRESET: 'e2e-fake', VIDEO_UPLOAD_PRESET: 'e2e-fake' };
    }
    const wanted = ['API_KEY', 'API_SECRET', 'CLOUD_NAME', 'UPLOAD_PRESET', 'VIDEO_UPLOAD_PRESET'];
    const lines = fs.readFileSync(path.join(TCG_DIR, '.env'), 'utf8').split(/\r?\n/);
    return Object.fromEntries(lines.map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(m => m && wanted.includes(m[1])).map(m => [m[1], m[2].trim()]));
};

const startStack = async () => {
    const started = [];
    const spawnLogged = (name, cmd, args, opts) => {
        const log = fs.openSync(path.join(os.tmpdir(), `tcg-e2e-${name}.log`), 'w');
        const child = spawn(cmd, args, { ...opts, stdio: ['ignore', log, log], windowsHide: true });
        started.push(child.pid);
        fs.writeFileSync(PIDS_FILE, JSON.stringify(started));
        return child;
    };

    if (!(await isListening(27099))) {
        const dbPath = path.join(os.tmpdir(), 'tcg-e2e-db');
        fs.rmSync(dbPath, { recursive: true, force: true });
        fs.mkdirSync(dbPath, { recursive: true });
        spawnLogged('mongod', MONGOD_PATH, ['--dbpath', dbPath, '--port', '27099', '--bind_ip', '127.0.0.1', '--wiredTigerCacheSizeGB', '0.25', '--quiet'], {});
        await waitFor(() => isListening(27099), 'MongoDB on port 27099', 30000);
    }

    if (await isListening(3005)) {
        if (REAL_CLOUDINARY) throw new Error('E2E_REAL_CLOUDINARY=1 needs port 3005 free so the server starts with the right keys.');
    } else {
        spawnLogged('server', process.execPath, ['bin/www'], {
            cwd: TCG_DIR,
            env: { ...process.env, ...cloudinaryEnv(), DB_URI, PORT: '3005', secretKey: 'e2e-local-secret', NODE_ENV: 'development' }
        });
        await waitFor(httpOk('http://localhost:3005/api/locations'), 'the TCG server on port 3005', 60000);
    }

    if (!(await isListening(3000))) {
        spawnLogged('portal', process.execPath, [path.join(PORTAL_DIR, 'node_modules', 'react-scripts', 'scripts', 'start.js')], {
            cwd: PORTAL_DIR,
            env: { ...process.env, BROWSER: 'none', PORT: '3000', GENERATE_SOURCEMAP: 'false', NODE_ENV: 'development' }
        });
        await waitFor(httpOk('http://localhost:3000'), 'the portal dev server on port 3000 (first compile takes a few minutes)', 8 * 60000);
    }
};

const stopStack = () => {
    if (!fs.existsSync(PIDS_FILE)) return;
    for (const pid of JSON.parse(fs.readFileSync(PIDS_FILE, 'utf8'))) {
        try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch (e) { /* already gone */ }
    }
    fs.rmSync(PIDS_FILE, { force: true });
};

module.exports = { startStack, stopStack, DB_URI, REAL_CLOUDINARY, TCG_DIR, cloudinaryEnv };
