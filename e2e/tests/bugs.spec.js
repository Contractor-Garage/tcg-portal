/**
 * Regression tests for the location editor bugs (B#) found in the November 2026 review,
 * driven through the real UI against the real server code.
 */
const { test, expect, openLocation, goToTab, makePng, setFakeUpload } = require('../support/fixtures');

test('B1 (Garage 9): Publish then Save keeps the location live', async ({ page, db, login, request }) => {
    const loc = await db.addLocation({ isDraft: true, isPublished: undefined, slug: 'e2e-garage-9' });
    await login();
    await openLocation(page, loc._id);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Location Published!')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Update Successful!')).toBeVisible();
    expect(await db.location(loc._id)).toMatchObject({ isDraft: false, isPublished: true });
    const pub = await (await request.get('http://localhost:3005/api/location/e2e-garage-9')).json();
    expect(pub && pub.slug).toBe('e2e-garage-9');
});

test('B6: removing Coming Soon is not undone by a later Save', async ({ page, db, login }) => {
    const loc = await db.addLocation({ comingSoon: true });
    await login();
    await openLocation(page, loc._id);
    await page.getByRole('button', { name: 'Remove Coming Soon' }).click();
    await expect(page.locator('.badge', { hasText: 'PUBLISHED' })).toBeVisible();
    await page.fill('#addressFirstLine', '1 New Street');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Update Successful!')).toBeVisible();
    expect((await db.location(loc._id)).comingSoon).toBe(false);
});

test('B7: clearing a field and saving clears it', async ({ page, db, login }) => {
    const loc = await db.addLocation({ addressSecondLine: 'Olathe, KS 66061' });
    await login();
    await openLocation(page, loc._id);
    await page.fill('#addressSecondLine', '');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Update Successful!')).toBeVisible();
    expect((await db.location(loc._id)).addressSecondLine).toBe('');
});

test('B11: Save on another tab right after the editor copy empties never creates a duplicate', async ({ page, db, login }) => {
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Unit and Pricing');
    await page.waitForTimeout(1500); // let the old 1-second reset timer fire, if it still exists
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Update Successful!')).toBeVisible();
    expect(await db.raw.collection('locations').countDocuments()).toBe(1);
});

const addImage = async (page, kind, caption) => {
    await page.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng() });
    await page.getByRole('button', { name: kind }).click();
    if (kind === 'Location Image') {
        await page.fill('#caption', caption);
        await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
};

test('B3: switching tabs while images upload keeps them on the next Save from another tab', async ({ page, db, login }) => {
    setFakeUpload({ delayMs: 3000 });
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Image Upload');
    await addImage(page, 'Banner Image');
    await addImage(page, 'Location Image', 'Front of the building');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/^Next:/).click(); // while the upload is still running
    await expect.poll(async () => ((await db.location(loc._id)).detailPageImages || []).length, { timeout: 20000 }).toBe(1);
    await goToTab(page, 'Video Upload');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(1500);
    const saved = await db.location(loc._id);
    expect(saved.bannerImage && saved.bannerImage.src).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(saved.detailPageImages).toHaveLength(1);
});
