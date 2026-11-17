/**
 * Test harness for the location editor.
 *
 * Renders the real LocationEdit (all tabs, the real Store) and replaces the network with a small
 * in-memory fake of the server, so tests can click through the editor and then check exactly what
 * the portal sent and what the "server" ended up storing. Test files must call jest.mock('axios').
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { useContext } from 'react';
import { MemoryRouter, Route, useHistory } from 'react-router-dom';
import Store, { AppContext } from '../context/Store';
import LocationEdit from '../routes/locations/locationEdit/LocationEdit';
import { HELPERS } from '../util/helpers';

// App.js normally registers the toast listener; record toasts so tests can assert on them.
export const toasts = [];
HELPERS.addToastListener((type, message) => toasts.push({ type, message }));

/**
 * The portal copies typed values into shared state in an effect that runs just after each render.
 * A real person always gives it a moment before clicking, so tests yield once after interacting.
 */
export const settle = () => act(() => new Promise(r => setTimeout(r, 0)));

/** Waits until every pending request and the state updates they cause have finished. */
export const flush = async () => { for (let i = 0; i < 5; i++) await settle(); };

/** In-memory stand-in for the location routes. `db` maps id -> stored location. */
export const fakeServer = { db: {}, requests: [], nextId: 1, holdGets: false, heldGets: [], holdPuts: false, heldPuts: [] };

/** Lets held saves (fakeServer.holdPuts = true) finish, like a slow server finally answering. */
export const releasePuts = async () => {
    fakeServer.holdPuts = false;
    fakeServer.heldPuts.splice(0).forEach(release => release());
    await flush();
};

/** Lets held location loads (fakeServer.holdGets = true) finish, like a slow server finally answering. */
export const releaseGets = async () => {
    fakeServer.holdGets = false;
    fakeServer.heldGets.splice(0).forEach(release => release());
    await flush();
};

const ok = (data) => Promise.resolve({ status: 200, data });

export const installFakeServer = (locations = []) => {
    fakeServer.db = Object.fromEntries(locations.map(l => [l._id, JSON.parse(JSON.stringify(l))]));
    fakeServer.requests = [];
    fakeServer.nextId = 1;
    fakeServer.holdGets = false;
    fakeServer.heldGets = [];
    fakeServer.holdPuts = false;
    fakeServer.heldPuts = [];
    toasts.length = 0;
    axios.get.mockImplementation((url) => {
        fakeServer.requests.push({ method: 'GET', url });
        const m = url.match(/\/portal\/location\/([^/]+)$/);
        if (m && fakeServer.db[m[1]]) {
            const answer = () => ok(JSON.parse(JSON.stringify(fakeServer.db[m[1]])));
            if (fakeServer.holdGets) return new Promise(resolve => fakeServer.heldGets.push(() => resolve(answer())));
            return answer();
        }
        return Promise.reject(Object.assign(new Error('not found'), { response: { status: 404 } }));
    });
    axios.put.mockImplementation((url, body) => {
        fakeServer.requests.push({ method: 'PUT', url, body: JSON.parse(JSON.stringify(body)) });
        const stored = fakeServer.db[body._id];
        if (!stored) return Promise.reject(Object.assign(new Error('missing'), { response: { status: 404 } }));
        if (body.slug === 'taken') return Promise.reject(Object.assign(new Error('slug taken'), { response: { status: 400 } }));
        Object.assign(stored, JSON.parse(JSON.stringify(body)));
        const answer = () => ok(JSON.parse(JSON.stringify(stored)));
        if (fakeServer.holdPuts) return new Promise(resolve => fakeServer.heldPuts.push(() => resolve(answer())));
        return answer();
    });
    axios.post.mockImplementation((url, body = {}) => {
        fakeServer.requests.push({ method: 'POST', url, body: JSON.parse(JSON.stringify(body)) });
        if (/\/portal\/location$/.test(url)) {
            const _id = 'new' + fakeServer.nextId++;
            fakeServer.db[_id] = { ...JSON.parse(JSON.stringify(body)), _id, isPublished: false };
            return ok(fakeServer.db[_id]);
        }
        let m = url.match(/\/portal\/location\/hide\/(.+)$/);
        if (m) { fakeServer.db[m[1]].isPublished = false; return ok('Update Successful'); }
        m = url.match(/\/portal\/location\/coming-soon\/(.+)$/);
        if (m) { fakeServer.db[m[1]].comingSoon = !!body.comingSoon; return ok({ _id: m[1], comingSoon: !!body.comingSoon }); }
        if (/\/portal\/location\/preview$/.test(url)) return ok({ _id: 'preview1' });
        return Promise.reject(new Error('unexpected POST ' + url));
    });
    axios.delete.mockImplementation((url) => {
        fakeServer.requests.push({ method: 'DELETE', url });
        return ok('Location Deleted.');
    });
};

/** Bodies of every PUT /portal/location the portal sent, oldest first. */
export const savedBodies = () => fakeServer.requests.filter(r => r.method === 'PUT').map(r => r.body);
export const lastSavedBody = () => savedBodies().slice(-1)[0];

/** Lets a test reach the Store directly, e.g. to empty the editor's copy the way the old reset timer did. */
export const store = { state: null, dispatch: null };
const StoreProbe = () => {
    const [state, dispatch] = useContext(AppContext);
    store.state = state;
    store.dispatch = dispatch;
    return null;
};
export const dispatch = async (action) => { act(() => store.dispatch(action)); await flush(); };

/** In-app navigation, e.g. leaving the editor for the list and opening another location. */
export const nav = { history: null };
const RouterProbe = () => { nav.history = useHistory(); return null; };
export const navigate = async (path) => { act(() => nav.history.push(path)); await flush(); };

/** Opens the editor for a location id (or 'new') and waits for it to load (unless told not to). */
export const openEditor = async (id, { waitForLoad = true } = {}) => {
    const utils = render(
        <Store>
            <StoreProbe />
            {/* Like the app's HashRouter, ask with window.confirm when a page blocks leaving. */}
            <MemoryRouter initialEntries={[`/location/${id}`]} getUserConfirmation={(message, callback) => callback(window.confirm(message))}>
                <RouterProbe />
                <Route path='/location/:slug'><LocationEdit /></Route>
            </MemoryRouter>
        </Store>
    );
    if (id !== 'new' && waitForLoad) {
        await waitFor(() => expect(screen.getByLabelText('Display Name')).toHaveValue(fakeServer.db[id].name || ''));
    }
    await flush();
    return utils;
};

/**
 * Clicks the "Next" / "Previous" links until the tab whose heading starts with `heading` is showing.
 * Headings: General, Thumbnail, Unit and Pricing Information, Image Upload, Video Upload, Payment Processing.
 */
export const goToTab = async (heading) => {
    const showing = () => screen.getByRole('heading', { level: 2 }).textContent.startsWith(heading);
    const order = ['General', 'Thumbnail', 'Unit and Pricing', 'Image Upload', 'Video Upload', 'Payment Processing'];
    for (let i = 0; i < 6 && !showing(); i++) {
        const current = order.findIndex(h => screen.getByRole('heading', { level: 2 }).textContent.startsWith(h));
        const target = order.findIndex(h => heading.startsWith(h) || h.startsWith(heading));
        userEvent.click(screen.getByText(target > current ? /^Next:/ : /^Previous:/));
        await flush();
    }
    expect(screen.getByRole('heading', { level: 2 }).textContent.startsWith(heading)).toBe(true);
};

export const click = async (name) => {
    userEvent.click(screen.getByRole('button', { name }));
    await flush();
};

export const type = async (label, text, { clear = true } = {}) => {
    const input = screen.getByLabelText(label);
    if (clear) userEvent.clear(input);
    if (text) userEvent.type(input, text);
    await flush();
};
