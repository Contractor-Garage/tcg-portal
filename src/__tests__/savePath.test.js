/**
 * Phase 2: one save path for every tab. Each test names the bug (B#) from the location editor review.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UPDATE_PREVIEW } from '../context/ActionTypes';
import { click, dispatch, fakeServer, flush, goToTab, installFakeServer, lastSavedBody, openEditor, savedBodies, toasts, type } from '../testUtils/editorHarness';

jest.mock('axios');

const base = {
    _id: 'loc1', name: 'Garage 9', slug: 'garage-9', addressFirstLine: '123 Main St', addressSecondLine: 'Olathe, KS 66061',
    coordinates: [38.88, -94.81], isDraft: false, isPublished: true, createdBy: 'u1', __v: 3,
    units: [], unitSummary: [], extras: [], features: [], detailPageImages: [], detailPageVideos: [],
    contactEmail: 'kevin@example.com', enablePayments: true, paypalEmail: 'pay@example.com', paymentMarkupPercent: 0.029, paymentMarkupFixed: 0.3
};
const draft = { ...base, _id: 'draft1', slug: 'draft-garage', isDraft: true, isPublished: undefined };

beforeEach(() => jest.clearAllMocks());

test('B1: Save after Publish does not put the location back into draft', async () => {
    installFakeServer([draft]);
    await openEditor('draft1');
    await click('Publish');
    await click('Save');
    expect(savedBodies()).toHaveLength(2);
    expect(lastSavedBody().isDraft).toBeUndefined();
    expect(fakeServer.db.draft1).toMatchObject({ isDraft: false, isPublished: true });
});

test('B1: Save on another tab after Publish does not put it back into draft either', async () => {
    installFakeServer([draft]);
    await openEditor('draft1');
    await click('Publish');
    await goToTab('Unit and Pricing');
    await click('Save');
    expect(fakeServer.db.draft1).toMatchObject({ isDraft: false, isPublished: true });
});

test('Save never sends status flags, the owner or internal fields', async () => {
    installFakeServer([base]);
    await openEditor('loc1');
    await click('Save');
    const body = lastSavedBody();
    ['isDraft', 'isPublished', 'comingSoon', 'createdBy', '__v'].forEach(key => expect(body).not.toHaveProperty(key));
    expect(body).toMatchObject({ _id: 'loc1', name: 'Garage 9' });
});

test('B6: removing Coming Soon is not undone by the next Save', async () => {
    installFakeServer([{ ...base, comingSoon: true }]);
    await openEditor('loc1');
    await click('Remove Coming Soon');
    expect(fakeServer.db.loc1.comingSoon).toBe(false);
    await type('Display Name', 'Garage 9 renamed');
    await click('Save');
    expect(fakeServer.db.loc1.comingSoon).toBe(false);
});

test('B7: clearing a field on the General tab saves it as empty', async () => {
    installFakeServer([base]);
    await openEditor('loc1');
    await type('Address (Second Line)', '');
    await type('Contact Email', '');
    await click('Save');
    expect(lastSavedBody()).toMatchObject({ addressSecondLine: '', contactEmail: '' });
});

test('turning payments off is saved (a cleared PayPal email is blocked by the required-field check instead)', async () => {
    installFakeServer([base]);
    await openEditor('loc1');
    await goToTab('Payment Processing');
    userEvent.click(screen.getByLabelText('Enable Payments'));
    await flush();
    await click('Save');
    expect(lastSavedBody().enablePayments).toBe(false);
});

test('B12: a payment markup of 0 shows as 0 after reopening, not blank', async () => {
    installFakeServer([{ ...base, paymentMarkupPercent: 0, paymentMarkupFixed: 0 }]);
    await openEditor('loc1');
    await goToTab('Payment Processing');
    expect(screen.getByLabelText(/Markup Percentage/i)).toHaveValue(0);
    expect(screen.getByLabelText(/Markup Amount/i)).toHaveValue(0);
});

test('B13: Publish checks the form first', async () => {
    installFakeServer([draft]);
    await openEditor('draft1');
    await type('Display Name', '');
    await click('Publish');
    expect(savedBodies()).toHaveLength(0);
    expect(toasts.map(t => t.type)).toContain('WARNING');
});

test('B13: a slug that is already taken shows the slug error when publishing', async () => {
    installFakeServer([draft]);
    await openEditor('draft1');
    await type('URL Slug', 'taken');
    await click('Publish');
    expect(screen.getByText(/url slug must be unique/i)).toBeInTheDocument();
    expect(fakeServer.db.draft1.isDraft).toBe(true);
});

test('B11: Save never creates a duplicate location when the editor copy was emptied', async () => {
    installFakeServer([base]);
    await openEditor('loc1');
    await goToTab('Unit and Pricing');
    await dispatch({ type: UPDATE_PREVIEW, payload: {} }); // what the old 1-second reset timer did
    await click('Save');
    expect(fakeServer.requests.some(r => r.method === 'POST')).toBe(false);
    expect(lastSavedBody()._id).toBe('loc1');
});

test('B13: a new location needs a name and slug before it can be saved from another tab', async () => {
    installFakeServer([]);
    await openEditor('new');
    await goToTab('Unit and Pricing');
    await click('Save As Draft');
    expect(fakeServer.requests.some(r => r.method === 'POST')).toBe(false);
    expect(toasts.map(t => t.message).join(' ')).toMatch(/Display Name and URL Slug/);
});
