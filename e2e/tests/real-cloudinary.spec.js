/**
 * Opt-in check against the REAL Cloudinary account: set E2E_REAL_CLOUDINARY=1 (port 3005 must be free).
 * Uses the local test database, so only files this test uploads can ever be deleted; any it leaves
 * behind are removed at the end.
 */
const { test, expect, openLocation, goToTab, makePng } = require('../support/fixtures');
const { REAL_CLOUDINARY, cloudinaryEnv } = require('../support/stack');

test.skip(!REAL_CLOUDINARY, 'Set E2E_REAL_CLOUDINARY=1 to run against the real Cloudinary account');

const keys = REAL_CLOUDINARY ? cloudinaryEnv() : {};
const adminApi = (method, path) => fetch(`https://api.cloudinary.com/v1_1/${keys.CLOUD_NAME}${path}`, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(`${keys.API_KEY}:${keys.API_SECRET}`).toString('base64') }
});
const publicIdOf = url => url.split('/upload/')[1].replace(/^v\d+\//, '').replace(/\.[a-z0-9]+$/i, '');
const exists = async id => (await adminApi('GET', `/resources/image/upload/${id}`)).status === 200;
const uploadedIds = [];

test.afterAll(async () => {
    for (const id of uploadedIds) {
        if (await exists(id)) await adminApi('DELETE', `/resources/image/upload?public_ids[]=${encodeURIComponent(id)}`);
    }
});

test('real Cloudinary: uploads are stored, and removed or deleted files are deleted', async ({ page, db, login }) => {
    test.setTimeout(180_000);
    const loc = await db.addLocation({ name: 'E2E Real Upload', slug: 'e2e-real-upload' });
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Image Upload');
    for (const caption of ['first', 'second']) {
        await page.locator('input[type=file]').first().setInputFiles({ name: `${caption}.png`, mimeType: 'image/png', buffer: makePng(320 + caption.length, 240) });
        await page.getByRole('button', { name: 'Location Image' }).click();
        await page.fill('#caption', caption);
        await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => ((await db.location(loc._id)).detailPageImages || []).length, { timeout: 60000 }).toBe(2);
    const images = (await db.location(loc._id)).detailPageImages;
    const ids = images.map(image => publicIdOf(image.src));
    uploadedIds.push(...ids);
    expect(ids.every(id => id.startsWith('TCG/'))).toBe(true);
    expect(await exists(ids[0])).toBe(true);
    expect(await exists(ids[1])).toBe(true);

    // Remove the first gallery image in the editor and save: the server deletes that file only.
    const removedId = publicIdOf(images[0].src);
    const keptId = publicIdOf(images[1].src);
    await page.getByTitle(/^Delete/).first().click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await db.location(loc._id)).detailPageImages.length).toBe(1);
    await expect.poll(() => exists(removedId), { timeout: 30000 }).toBe(false);
    expect(await exists(keptId)).toBe(true);

    // Delete the whole location: its remaining file is deleted too (B14).
    await goToTab(page, 'General');
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => db.location(loc._id)).toBeNull();
    await expect.poll(() => exists(keptId), { timeout: 30000 }).toBe(false);
});
