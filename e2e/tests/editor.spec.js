/**
 * Location editor, driven through the real UI. Behavior that works today and must keep working.
 */
const { test, expect, openLocation, goToTab, makePng } = require('../support/fixtures');

test('editing a field and saving stores it', async ({ page, db, login }) => {
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await expect(page.locator('#name')).toHaveValue('E2E Garage');
    await page.fill('#addressFirstLine', '500 Test Ave');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Update Successful!')).toBeVisible();
    expect((await db.location(loc._id)).addressFirstLine).toBe('500 Test Ave');
});

test('publishing a draft puts it on the public site', async ({ page, db, login, request }) => {
    const loc = await db.addLocation({ isDraft: true, isPublished: undefined, slug: 'e2e-draft' });
    await login();
    await openLocation(page, loc._id);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Location Published!')).toBeVisible();
    expect(await db.location(loc._id)).toMatchObject({ isDraft: false, isPublished: true });
    const pub = await (await request.get('http://localhost:3005/api/location/e2e-draft')).json();
    expect(pub && pub.name).toBe('E2E Garage');
});

test('hiding a location brings back the Publish button', async ({ page, db, login }) => {
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await page.getByRole('button', { name: 'Hide Location' }).click();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    expect((await db.location(loc._id)).isPublished).toBe(false);
});

test('coming soon can be turned on from the editor', async ({ page, db, login }) => {
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await page.getByRole('button', { name: 'Mark as Coming Soon' }).click();
    await expect(page.locator('.badge', { hasText: 'COMING SOON' })).toBeVisible();
    expect((await db.location(loc._id)).comingSoon).toBe(true);
});

test('a gallery image added on the Image tab is uploaded and saved', async ({ page, db, login }) => {
    const loc = await db.addLocation();
    await login();
    await openLocation(page, loc._id);
    await goToTab(page, 'Image Upload');
    await page.locator('input[type=file]').setInputFiles({ name: 'garage.png', mimeType: 'image/png', buffer: makePng() });
    await page.getByRole('button', { name: 'Location Image' }).click();
    await page.fill('#caption', 'Front of the building');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Update Successful!')).toBeVisible();
    await expect.poll(async () => ((await db.location(loc._id)).detailPageImages || []).length).toBe(1);
    const saved = (await db.location(loc._id)).detailPageImages[0];
    expect(saved.alt).toBe('Front of the building');
    expect(saved.src).toMatch(/^https:\/\/res\.cloudinary\.com\//);
});
