import { TAB_MEDIA, TAB_THUMBNAIL, TAB_VIDEO } from '../shared/Constants';
import { HELPERS, TOAST_TYPES } from './helpers';

/**
 * Fields an editor tab may change with Save. Everything else is owned by the server or by its own
 * action: isDraft/isPublished change only through Publish and Hide, comingSoon through its own
 * button, and ownership/ids never. Leaving those out of Save is what stops a stale copy in the
 * editor from putting a published location back into draft (B1) or undoing Coming Soon (B6).
 */
export const EDITABLE_FIELDS = [
    'name', 'slug', 'addressFirstLine', 'addressSecondLine', 'coordinates', 'shortDescription', 'longDescription',
    'features', 'contactName', 'contactPhone', 'contactEmail',
    'thumbnailImage', 'bannerImage', 'detailPageImages', 'detailPageVideos',
    'units', 'unitSummary', 'extras', 'availabilityNote',
    'enablePayments', 'paypalEmail', 'paymentMarkupPercent', 'paymentMarkupFixed'
];

// Single images the user can remove; a removed one is sent as null so the removal is saved.
const REMOVABLE_IMAGES = ['thumbnailImage', 'bannerImage'];

/**
 * The id of the location being edited: the editor's copy, or else the id in the page address.
 * Never 'new'. Using the address as a fallback means a Save can't create a duplicate location
 * just because the editor's copy was briefly empty (B11).
 */
export const resolveLocationId = (previewLocation, history) => {
    if (previewLocation && previewLocation._id) return previewLocation._id;
    const fromAddress = history && history.location && history.location.pathname.split('/location/')[1];
    return fromAddress && fromAddress !== 'new' ? fromAddress : undefined;
};

/** Body for PUT /portal/location. Publish adds the two flags that make a location live. */
export const buildSaveRequest = (previewLocation, id, { publish = false } = {}) => {
    const body = { _id: id };
    EDITABLE_FIELDS.forEach(field => {
        if (!(field in previewLocation)) return;
        const value = previewLocation[field];
        if (value === undefined) {
            if (REMOVABLE_IMAGES.includes(field)) body[field] = null;
            return;
        }
        // A copy, so a tab adjusting its request can never change the editor's own copy.
        body[field] = value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
    });
    if (publish) {
        body.isPublished = true;
        body.isDraft = false;
    }
    return body;
};

/** Body for POST /portal/location: a brand-new location always starts as a draft. */
export const buildCreateRequest = (previewLocation) => {
    const body = { isDraft: true };
    EDITABLE_FIELDS.forEach(field => {
        if (previewLocation[field] !== undefined && previewLocation[field] !== null) body[field] = previewLocation[field];
    });
    return body;
};

/**
 * A new location needs a name and URL slug before it can be saved from any tab. Without this,
 * saving from another tab created a nameless location that later clashed on the empty slug.
 */
export const canCreate = (previewLocation) => {
    if (previewLocation && previewLocation.name && previewLocation.slug) return true;
    HELPERS.showToast(TOAST_TYPES.WARNING, 'Add a Display Name and URL Slug on the General tab before saving this new location.');
    return false;
};

/** The server-owned fields from a save reply, to keep the editor's copy in step with the database. */
export const serverOwnedFields = (saved) => {
    const fields = {};
    if (!saved || typeof saved !== 'object') return fields;
    ['_id', 'isDraft', 'isPublished', 'comingSoon'].forEach(key => {
        if (key in saved) fields[key] = saved[key];
    });
    return fields;
};

const MEDIA_FIELDS = ['thumbnailImage', 'bannerImage', 'detailPageImages', 'detailPageVideos'];

/**
 * Status and media fields from a save reply. Upload callbacks merge these into the editor's shared
 * copy directly, so it matches what was stored even if the tab that started the upload has closed (B3).
 */
export const savedFields = (saved) => {
    const fields = serverOwnedFields(saved);
    if (saved && typeof saved === 'object') {
        MEDIA_FIELDS.forEach(key => { if (key in saved) fields[key] = saved[key]; });
    }
    return fields;
};

const hasItems = value => Array.isArray(value) ? value.length > 0 : !!value;

/** Names of tabs (other than `ownTab`) holding files that haven't been uploaded yet. */
export const pendingUploadsElsewhere = (state, ownTab) => {
    const tabs = [];
    if (ownTab !== TAB_THUMBNAIL && hasItems(state.thumbnailImage_pending)) tabs.push('Thumbnail');
    if (ownTab !== TAB_MEDIA && (hasItems(state.bannerImage_pending) || hasItems(state.detailPageImages_pending))) tabs.push('Image');
    if (ownTab !== TAB_VIDEO && (hasItems(state.videos_pending) || Object.keys(state.posterUpdates_pending || {}).length > 0)) tabs.push('Video');
    return tabs;
};

/** True if anything anywhere in the editor is waiting to be uploaded. */
export const hasPendingUploads = (state) => pendingUploadsElsewhere(state, null).length > 0;

/**
 * Files only upload when Save is clicked on their own tab. Saving from another tab used to report
 * success while silently skipping them (B8), so stop and say where to go instead.
 */
export const warnIfPendingElsewhere = (state, ownTab) => {
    const tabs = pendingUploadsElsewhere(state, ownTab);
    if (tabs.length === 0) return false;
    HELPERS.showToast(TOAST_TYPES.WARNING, `New files on the ${tabs.join(' and ')} tab${tabs.length > 1 ? 's' : ''} haven't been uploaded yet. Open that tab and click Save there first.`);
    return true;
};

/** One clear message when an upload, or saving its result, fails (B10). */
export const uploadFailed = (err) => {
    console.log(err);
    HELPERS.showToast(TOAST_TYPES.ERROR, 'The upload did not finish, so the new files were not saved. Please check your connection and click Save again.');
};
