import React, { useContext, useEffect, useState } from 'react';
import { Prompt, useHistory, useLocation } from 'react-router-dom';
import GeneralTabView from '../../../components/generalTabView/GeneralTabView';
import MediaTabView from '../../../components/mediaTabView/MediaTabView';
import PaymentTabView from '../../../components/paymentTabView/PaymentTabView';
import ThumbnailTabView from '../../../components/thumbnailTabView/ThumbnailTabView';
import UnitTabView from '../../../components/unitTabView/UnitTabView';
import VideoTabView from '../../../components/videoTabView/VideoTabView';
import { SET_BANNER_IMAGE_PENDING, SET_DETAIL_PAGE_IMAGES_PENDING, SET_POSTER_UPDATES_PENDING, SET_TABVIEW, SET_THUMBNAIL_IMAGE_PENDING, SET_UPLOADING, SET_VIDEO_PENDING, UPDATE_PREVIEW } from '../../../context/ActionTypes';
import { AppContext } from '../../../context/Store';
import { TAB_GENERAL, TAB_MEDIA, TAB_PAYMENT, TAB_THUMBNAIL, TAB_UNIT, TAB_VIDEO } from '../../../shared/Constants';
import { API } from '../../../util/API';
import { hasPendingUploads } from '../../../util/locationSave';

const LocationEdit = () => {
    const routeLocation = useLocation();
    const history = useHistory();
    const locationId = routeLocation.pathname.split('/location/')[1];
    const [location, setLocation] = useState({});
    const [state, dispatch] = useContext(AppContext);

    /** Clears everything the editor keeps for one location: its shared copy and any files waiting to upload. */
    const resetEditor = () => {
        dispatch({type: UPDATE_PREVIEW, payload: {}});
        dispatch({type: SET_DETAIL_PAGE_IMAGES_PENDING, payload: undefined});
        dispatch({type: SET_BANNER_IMAGE_PENDING, payload: undefined});
        dispatch({type: SET_THUMBNAIL_IMAGE_PENDING, payload: undefined});
        dispatch({type: SET_VIDEO_PENDING, payload: undefined});
        dispatch({type: SET_POSTER_UPDATES_PENDING, payload: undefined});
        dispatch({type: SET_UPLOADING, payload: false});
    };

    useEffect(() => {
        // Start clean and finish clean, straight away. The old reset ran 1 second after leaving, so it
        // could empty the next location's editor after it had opened (B11), and it missed thumbnail and
        // video files, which then carried over into the next location (B8).
        resetEditor();
        if (locationId === 'new') {
            setLocation({isDraft: true});
        }
        else {
            API.getLocationById(locationId, (res, err) => {
                if (res && res.status === 200) {
                    setLocation(res.data);
                }
                else {
                    console.log(err);
                    history.push('/locations');
                }
            });
        }

        return () => {
            resetEditor();
            dispatch({type: SET_TABVIEW, payload: TAB_GENERAL});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Leaving while files upload, or before new files are uploaded, would lose them (B8, B16).
    const blockLeaving = state.uploading || hasPendingUploads(state);
    useEffect(() => {
        if (!blockLeaving) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [blockLeaving]);

    const leaveMessage = (next) => {
        // Moving to this location's own address (after creating it) is not leaving.
        if (next.pathname.startsWith('/location/')) return true;
        return state.uploading
            ? 'Files are still uploading. If you leave now they will not be saved. Leave anyway?'
            : 'Some new files have not been uploaded yet. Click Save on their tab first. Leave anyway and lose them?';
    };

    return (
        <div className='LocationEdit'>
            <Prompt when={blockLeaving} message={leaveMessage} />
            {
                state.tabView === TAB_GENERAL &&
                <GeneralTabView location={location}/>
            }
            {
                state.tabView === TAB_THUMBNAIL &&
                <ThumbnailTabView location={location}/>
            }
            {
                state.tabView === TAB_UNIT &&
                <UnitTabView location={location}/>
            }
            {
                state.tabView === TAB_MEDIA &&
                <MediaTabView location={location}/>
            }
            {
                state.tabView === TAB_VIDEO &&
                <VideoTabView location={location}/>
            }
            {
                state.tabView === TAB_PAYMENT &&
                <PaymentTabView location={location}/>
            }
        </div>
    );
};

export default LocationEdit;
