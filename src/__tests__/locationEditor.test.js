/**
 * Location editor: behavior that works today and must keep working.
 * Run with `npm run test:once` (or `npm test` for watch mode).
 */
import { screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import { click, fakeServer, goToTab, installFakeServer, lastSavedBody, openEditor, savedBodies, toasts, type } from '../testUtils/editorHarness';

jest.mock('axios');

const published = {
    _id: 'loc1', name: 'Garage 9', slug: 'garage-9', addressFirstLine: '123 Main St', addressSecondLine: 'Olathe, KS 66061',
    coordinates: [38.88, -94.81], isDraft: false, isPublished: true, createdBy: 'u1',
    units: [], unitSummary: [], extras: [], features: [], detailPageImages: [], detailPageVideos: []
};
const draft = { ...published, _id: 'draft1', name: 'Draft Garage', slug: 'draft-garage', isDraft: true, isPublished: undefined };

beforeEach(() => jest.clearAllMocks());

test('opening a location fills the General form', async () => {
    installFakeServer([published]);
    await openEditor('loc1');
    expect(screen.getByLabelText('Display Name')).toHaveValue('Garage 9');
    expect(screen.getByLabelText('URL Slug')).toHaveValue('garage-9');
    expect(screen.getByText('PUBLISHED')).toBeInTheDocument();
});

test('editing a field and clicking Save sends the new value', async () => {
    installFakeServer([published]);
    await openEditor('loc1');
    await type('Display Name', 'Garage Nine');
    await click('Save');
    expect(lastSavedBody()).toMatchObject({ _id: 'loc1', name: 'Garage Nine' });
    expect(toasts.map(t => t.message)).toContain('Update Successful!');
});

test('Publish on a draft makes it live and hides the Publish button', async () => {
    installFakeServer([draft]);
    await openEditor('draft1');
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    await click('Publish');
    expect(lastSavedBody()).toMatchObject({ _id: 'draft1', isPublished: true, isDraft: false });
    expect(fakeServer.db.draft1).toMatchObject({ isPublished: true, isDraft: false });
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByText('PUBLISHED')).toBeInTheDocument();
});

test('Hide Location takes it off the site and brings back the Publish button', async () => {
    installFakeServer([published]);
    await openEditor('loc1');
    await click('Hide Location');
    expect(fakeServer.db.loc1.isPublished).toBe(false);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
});

test('Mark as Coming Soon sets the flag', async () => {
    installFakeServer([published]);
    await openEditor('loc1');
    await click('Mark as Coming Soon');
    expect(fakeServer.db.loc1.comingSoon).toBe(true);
    expect(screen.getByText('COMING SOON')).toBeInTheDocument();
});

test('a new location is created by Save As Draft', async () => {
    installFakeServer([]);
    await openEditor('new');
    await type('Display Name', 'Brand New');
    await type('URL Slug', 'brand-new');
    await type('Latitude', '38.9');
    await type('Longitude', '-94.7');
    await click('Save As Draft');
    const create = fakeServer.requests.find(r => r.method === 'POST' && /\/portal\/location$/.test(r.url));
    expect(create.body).toMatchObject({ name: 'Brand New', slug: 'brand-new', isDraft: true });
    expect(axios.put).not.toHaveBeenCalled();
});

test('the availability note on the Unit tab is saved', async () => {
    installFakeServer([published]);
    await openEditor('loc1');
    await goToTab('Unit and Pricing');
    await type('Availability Note', 'Early bird lease-up sale');
    await click('Save');
    expect(lastSavedBody()).toMatchObject({ _id: 'loc1', availabilityNote: 'Early bird lease-up sale' });
});

test('edits made on one tab are kept when saving from another tab', async () => {
    installFakeServer([published]);
    await openEditor('loc1');
    await type('Display Name', 'Renamed On General');
    await goToTab('Unit and Pricing');
    await click('Save');
    expect(lastSavedBody()).toMatchObject({ name: 'Renamed On General' });
});

test('every tab opens without errors', async () => {
    installFakeServer([published]);
    await openEditor('loc1');
    for (const heading of ['Thumbnail', 'Unit and Pricing', 'Image Upload', 'Video Upload', 'Payment Processing', 'General']) {
        await goToTab(heading);
    }
    await waitFor(() => expect(screen.getByLabelText('Display Name')).toHaveValue('Garage 9'));
    expect(savedBodies()).toHaveLength(0);
});
