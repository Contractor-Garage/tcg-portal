/**
 * Shared browser-test fixtures.
 *  - `page`: locked down so it can only talk to localhost. Cloudinary uploads are answered with fake
 *    file URLs unless E2E_REAL_CLOUDINARY=1, in which case Cloudinary itself is also allowed.
 *  - `db`: direct access to the throwaway test database, reseeded before every test.
 *  - `login()`: signs in as the seeded test admin.
 */
const base = require('@playwright/test');
const { MongoClient, ObjectId } = require('mongodb');
const { DB_URI, REAL_CLOUDINARY } = require('./stack');

// bcrypt hash of 'e2e-password' (cost 10), made with the server's own bcrypt.
const ADMIN_PASSWORD_HASH = '$2b$10$BNGmraAjnQKJqBGeoMkbFemoIjiJ/HDxrY/K3XJGnbB45W8g0yUz6';
const ADMIN_ID = new ObjectId('64e2e0000000000000000001');

const fakeUploads = [];
// How the fake Cloudinary behaves for the next test: { delayMs, fail }. Reset before every test.
const fakeUploadBehavior = { delayMs: 0, fail: false };
const setFakeUpload = ({ delayMs = 0, fail = false } = {}) => { fakeUploadBehavior.delayMs = delayMs; fakeUploadBehavior.fail = fail; };

const test = base.test.extend({
    db: async ({}, use) => {
        if (!/127\.0\.0\.1:27099/.test(DB_URI)) throw new Error('E2E tests may only use the local test database');
        const client = await MongoClient.connect(DB_URI, { useUnifiedTopology: true });
        const db = client.db();
        await db.collection('locations').deleteMany({});
        await db.collection('users').deleteMany({});
        await db.collection('users').insertOne({ _id: ADMIN_ID, firstName: 'E2E', lastName: 'Admin', username: 'e2e-admin', password: ADMIN_PASSWORD_HASH, isAdmin: true, isSuperAdmin: true });
        const helpers = {
            raw: db,
            /** Inserts a location (defaults: published, owned by the test admin) and returns it. */
            addLocation: async (fields = {}) => {
                const doc = { _id: new ObjectId(), name: 'E2E Garage', slug: 'e2e-garage', coordinates: [38.88, -94.81], features: [], units: [], unitSummary: [], extras: [], detailPageImages: [], detailPageVideos: [], isDraft: false, isPublished: true, createdBy: ADMIN_ID, ...fields };
                await db.collection('locations').insertOne(doc);
                return doc;
            },
            location: (id) => db.collection('locations').findOne({ _id: new ObjectId(String(id)) })
        };
        await use(helpers);
        await client.close();
    },

    page: async ({ page }, use) => {
        setFakeUpload();
        const allowed = REAL_CLOUDINARY
            ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|^https:\/\/(api|res)\.cloudinary\.com\//
            : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
        await page.route(url => !allowed.test(url.href), route => route.abort());
        if (!REAL_CLOUDINARY) {
            await page.route(/^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/(image|video)\/upload/, async (route) => {
                if (fakeUploadBehavior.delayMs) await new Promise(r => setTimeout(r, fakeUploadBehavior.delayMs));
                if (fakeUploadBehavior.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"e2e upload failure"}}' });
                const kind = route.request().url().includes('/video/') ? 'video' : 'image';
                const n = fakeUploads.length + 1;
                const folder = kind === 'video' ? 'GARAGEVIDEOS' : 'TCG';
                const secure_url = `https://res.cloudinary.com/e2e-fake-cloud/${kind}/upload/v1/${folder}/e2e-${n}.${kind === 'video' ? 'mp4' : 'jpg'}`;
                fakeUploads.push(secure_url);
                await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ secure_url, public_id: `${folder}/e2e-${n}` }) });
            });
        }
        page.on('dialog', dialog => dialog.accept());
        await use(page);
    },

    login: async ({ page }, use) => {
        await use(async () => {
            await page.goto('/#/login');
            await page.fill('#username', 'e2e-admin');
            await page.fill('#password', 'e2e-password');
            await page.getByRole('button', { name: /log ?in/i }).click();
            await page.waitForURL(url => !url.hash.startsWith('#/login'));
        });
    }
});

/** Opens the editor for a location and waits until it has loaded. */
const openLocation = async (page, id) => {
    await page.goto(`/#/location/${id}`);
    await base.expect(page.locator('#name')).not.toHaveValue('');
};

/** Clicks "Next"/"Previous" until the tab whose heading starts with `heading` shows. */
const goToTab = async (page, heading) => {
    const order = ['General', 'Thumbnail', 'Unit and Pricing', 'Image Upload', 'Video Upload', 'Payment Processing'];
    for (let i = 0; i < 6; i++) {
        const current = (await page.locator('h2').first().textContent()) || '';
        if (current.startsWith(heading)) return;
        const from = order.findIndex(h => current.startsWith(h));
        const to = order.findIndex(h => h.startsWith(heading) || heading.startsWith(h));
        // The links start or end with an arrow icon, so match their text inside the tab navigation.
        await page.locator('.tabViewNavSection a', { hasText: to > from ? 'Next:' : 'Previous:' }).click();
    }
    await base.expect(page.locator('h2').first()).toHaveText(new RegExp('^' + heading));
};

/** A small solid-colour PNG, built in memory, for upload tests. */
const makePng = (width = 400, height = 300) => {
    const zlib = require('zlib');
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

module.exports = { test, expect: base.expect, openLocation, goToTab, makePng, fakeUploads, setFakeUpload };
