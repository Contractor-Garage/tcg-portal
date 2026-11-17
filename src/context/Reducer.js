import { DELETE_USER, MERGE_PREVIEW, SET_POSTER_UPDATES_PENDING, SET_UPLOADING, OPEN_PREVIEW, RESET_PREVIEW, SET_BANNER_IMAGE_PENDING, SET_DETAIL_PAGE_IMAGES_PENDING, SET_TABVIEW, SET_THUMBNAIL_IMAGE_PENDING, SET_USER, SET_USERS, SET_VIDEO_PENDING, UPDATE_PREVIEW } from "./ActionTypes"

const Reducer = (state, action) => {
    switch (action.type) {
        case SET_USER:
            return {...state, currentUser: action.payload};
        case SET_USERS:
            return {...state, allUsers: action.payload};
        case DELETE_USER:
            return {...state, currentUser: null};
        // No switching tabs while files upload (from the tab links or the sidebar), so new files aren't lost (B3).
        case SET_TABVIEW:
            if (state.uploading) return state;
            return {...state, tabView: action.payload};
        case UPDATE_PREVIEW:
            return {...state, previewLocation: action.payload};
        // Merges fields into the editor's copy using the latest state, so it is safe to dispatch from a
        // request callback even after the tab that started the request has closed.
        case MERGE_PREVIEW:
            return {...state, previewLocation: {...state.previewLocation, ...action.payload}};
        // True while files are uploading; the editor blocks Save, tab changes and leaving meanwhile.
        case SET_UPLOADING:
            return {...state, uploading: action.payload};
        // New poster files for existing videos, by video id: { [videoId]: { file, url } }.
        case SET_POSTER_UPDATES_PENDING:
            return {...state, posterUpdates_pending: action.payload};
        case OPEN_PREVIEW:
            return {...state, openPreview: true};
        case RESET_PREVIEW:
            return {...state, openPreview: false};
        case SET_DETAIL_PAGE_IMAGES_PENDING:
            return {...state, detailPageImages_pending: action.payload};
        case SET_BANNER_IMAGE_PENDING:
            return {...state, bannerImage_pending: action.payload};
        case SET_THUMBNAIL_IMAGE_PENDING:
            return {...state, thumbnailImage_pending: action.payload};
        case SET_VIDEO_PENDING:
            return {...state, videos_pending: action.payload};
            
        default:
            return state;
    }
}

export default Reducer;