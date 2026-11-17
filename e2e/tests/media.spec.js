/**
 * Phase 3: media uploads (images, videos, posters) through the real UI. Cloudinary is faked here;
 * see real-cloudinary.spec.js for the opt-in check against the real account.
 */
const { ObjectId } = require('mongodb');
const { test, expect, openLocation, goToTab, makePng, setFakeUpload } = require('../support/fixtures');

const addGalleryImage = async (page, caption = 'Front of the building') => {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng() });
    await page.getByRole('button', { name: 'Location Image' }).click();
    await page.fill('#caption', caption);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
};
const save = page => page.getByRole('button', { name: 'Save', exact: true }).click();
const heading = page => page.locator('h2').first();

test('B3: while files upload, Save and tab changes wait, and a notice says so', async ({ page, db, login }) => {
    setFakeUpload({ delayMs: 3000 });
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Image Upload');
    await addGalleryImage(page);
    await save(page);
    await expect(page.getByText('Uploading files... Please stay on this tab')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.getByText(/^Next:/).click({ force: true }); // it is marked disabled, so force the click to show it's ignored
    await expect(heading(page)).toHaveText(/^Image Upload/);
    await expect.poll(async () => ((await db.location(loc._id)).detailPageImages || []).length, { timeout: 20000 }).toBe(1);
    await expect(page.getByText('Uploading files... Please stay on this tab')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});

test('B8: Save on another tab waits until new files are uploaded on their own tab', async ({ page, db, login }) => {
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Image Upload');
    await addGalleryImage(page);
    await goToTab(page, 'General');
    await page.fill('#addressFirstLine', '9 Waiting Street');
    await save(page);
    await expect(page.getByText(/haven't been uploaded yet/)).toBeVisible();
    expect((await db.location(loc._id)).addressFirstLine).toBeUndefined();
    await goToTab(page, 'Image Upload');
    await save(page);
    await expect.poll(async () => ((await db.location(loc._id)).detailPageImages || []).length).toBe(1);
    expect((await db.location(loc._id)).addressFirstLine).toBe('9 Waiting Street');
});

test('B10: a failed video upload stops the spinner, says so, and can be retried', async ({ page, db, login }) => {
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Video Upload');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'tour.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) });
    await page.getByRole('button', { name: 'Skip' }).click();
    setFakeUpload({ fail: true });
    await save(page);
    await expect(page.getByText(/upload did not finish/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    expect((await db.location(loc._id)).detailPageVideos).toHaveLength(0);
    setFakeUpload();
    await save(page);
    await expect.poll(async () => ((await db.location(loc._id)).detailPageVideos || []).length).toBe(1);
});

test('Publish with new files only goes live once they have uploaded', async ({ page, db, login }) => {
    const loc = await db.addLocation({ isDraft: true, isPublished: undefined });
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Image Upload');
    await addGalleryImage(page);
    setFakeUpload({ fail: true });
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText(/upload did not finish/)).toBeVisible();
    expect((await db.location(loc._id)).isPublished).not.toBe(true);
    setFakeUpload();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect.poll(async () => (await db.location(loc._id)).isPublished).toBe(true);
    expect(await db.location(loc._id)).toMatchObject({ isDraft: false });
    expect((await db.location(loc._id)).detailPageImages).toHaveLength(1);
});

test('B4: a changed video poster is never saved as a browser-only link', async ({ page, db, login }) => {
    const oldPoster = 'https://res.cloudinary.com/e2e-fake-cloud/image/upload/v1/TCG/old-poster.jpg';
    const loc = await db.addLocation({ detailPageVideos: [{ _id: new ObjectId(), src: 'https://res.cloudinary.com/e2e-fake-cloud/video/upload/v1/GARAGEVIDEOS/tour.mp4', poster: oldPoster }] });
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Video Upload');
    await page.getByTitle('Edit').first().click();
    await page.locator('.modal input[type=file]').setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: makePng() });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Update' }).click();
    await goToTab(page, 'General');
    await save(page);
    await expect(page.getByText(/haven't been uploaded yet/)).toBeVisible();
    expect((await db.location(loc._id)).detailPageVideos[0].poster).toBe(oldPoster);
    await goToTab(page, 'Video Upload');
    await save(page);
    await expect.poll(async () => (await db.location(loc._id)).detailPageVideos[0].poster).not.toBe(oldPoster);
    expect((await db.location(loc._id)).detailPageVideos[0].poster).toMatch(/^https:\/\/res\.cloudinary\.com\/e2e-fake-cloud\/image\/upload\//);
});
