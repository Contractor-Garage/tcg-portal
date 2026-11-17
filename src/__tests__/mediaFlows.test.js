/**
 * Phase 3: media flows. Each test names the bug (B#) from the location editor review.
 * (Uploads themselves are covered by the Playwright tests in e2e/tests/media.spec.js.)
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SET_TABVIEW, SET_THUMBNAIL_IMAGE_PENDING, SET_UPLOADING } from '../context/ActionTypes';
import { TAB_PAYMENT } from '../shared/Constants';
import { click, dispatch, flush, goToTab, installFakeServer, navigate, openEditor, savedBodies, store, toasts } from '../testUtils/editorHarness';

jest.mock('axios');

const base = {
    _id: 'loc1', name: 'Garage 9', slug: 'garage-9', coordinates: [38.88, -94.81], isDraft: false, isPublished: true,
    units: [], unitSummary: [], extras: [], features: [], detailPageImages: [], detailPageVideos: []
};

beforeEach(() => jest.clearAllMocks());

test('B8: Save on another tab waits while a new thumbnail is still waiting to upload', async () => {
    installFakeServer([base]);
    await openEditor('loc1');
    await dispatch({ type: SET_THUMBNAIL_IMAGE_PENDING, payload: { file: new File(['x'], 'thumb.png'), src: 'blob:thumb' } });
    await click('Save');
    expect(savedBodies()).toHaveLength(0);
    expect(toasts.map(t => t.message).join(' ')).toMatch(/Thumbnail tab haven't been uploaded yet/);
});

test('B8/B11: leaving with files waiting asks first, then nothing carries over to the next location', async () => {
    installFakeServer([base, { ...base, _id: 'loc2', name: 'Grandview', slug: 'grandview' }]);
    const confirm = jest.spyOn(window, 'confirm').mockImplementation(() => true);
    await openEditor('loc1');
    await dispatch({ type: SET_THUMBNAIL_IMAGE_PENDING, payload: { file: new File(['x'], 'thumb.png'), src: 'blob:thumb' } });
    await navigate('/locations');
    expect(confirm).toHaveBeenCalled();
    expect(store.state.thumbnailImage_pending).toBeUndefined();
    await navigate('/location/loc2');
    expect(store.state.thumbnailImage_pending).toBeUndefined();
    confirm.mockRestore();
});

test('B3: while files upload, Save is disabled and tab changes wait', async () => {
    installFakeServer([base]);
    await openEditor('loc1');
    await dispatch({ type: SET_UPLOADING, payload: true });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/Uploading files/)).toBeInTheDocument();
    userEvent.click(screen.getByText(/^Next:/));
    await flush();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/^General/);
    await dispatch({ type: SET_UPLOADING, payload: false });
    await goToTab('Thumbnail');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/^Thumbnail/);
});

test('B3: the sidebar tab links also wait while files upload', async () => {
    installFakeServer([base]);
    await openEditor('loc1');
    await dispatch({ type: SET_UPLOADING, payload: true });
    await dispatch({ type: SET_TABVIEW, payload: TAB_PAYMENT }); // what the sidebar links do
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/^General/);
    await dispatch({ type: SET_UPLOADING, payload: false });
    await dispatch({ type: SET_TABVIEW, payload: TAB_PAYMENT });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/^Payment Processing/);
});
