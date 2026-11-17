import React, {
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState
} from 'react';
import { useDropzone } from 'react-dropzone';
import Compress from 'compress.js';
import { MERGE_PREVIEW, SET_POSTER_UPDATES_PENDING, SET_UPLOADING, SET_VIDEO_PENDING, UPDATE_PREVIEW } from '../../context/ActionTypes';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';
import { AppContext } from '../../context/Store';
import { TAB_MEDIA, TAB_PAYMENT, TAB_VIDEO } from '../../shared/Constants';
import { HELPERS, TOAST_TYPES } from '../../util/helpers';
import { buildCreateRequest, buildSaveRequest, canCreate, remindPendingElsewhere, resolveLocationId, savedFields, serverOwnedFields, sessionDispatch, uploadFailed } from '../../util/locationSave';
import TabView from '../tabView/TabView';
import VideoCard from '../videoCard/VideoCard';
import './VideoTabView.sass';
import { API } from '../../util/API';
import { useHistory } from 'react-router-dom';

const VideoTabView = ({ location }) => {
    const [state, dispatch] = useContext(AppContext);
    const history = useHistory();

    const [detailPageVideos, setDetailPageVideos] = useState();
    const [showLoader, setShowLoader] = useState(false);
    const [isPublished, setIsPublished] = useState();

    // State for new video object being created before it is uploaded
    const [currentVideo, setCurrentVideo] = useState();
    const [currentPoster, setCurrentPoster] = useState();
    const [isEditing_pending, setIsEditing_pending] = useState(false); // Flag for editing a pending video
    const [editingIndex_pending, setEditingIndex_pending] = useState(-1);

    // Editing modal state
    const [showPosterModal, setShowPosterModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editingIndex, setEditingIndex] = useState(-1);

    // True once the location has loaded into this tab (see GeneralTabView).
    const ready = useRef(false);

    const compress = new Compress();

    /**
     * Every time a field changes, update the preview, so when this tab is exited the preview retains its data.
     */
    useEffect(() => {
        updatePreview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detailPageVideos, isPublished]);

    useEffect(() => {
        const locationWithChanges = {
            ...location,
            ...state.previewLocation
        };
        setDetailPageVideos(
            locationWithChanges.detailPageVideos
                ? locationWithChanges.detailPageVideos
                : undefined
        );
        setIsPublished(
            locationWithChanges.isPublished
                ? locationWithChanges.isPublished
                : null
        );
        if (Object.keys(location).length > 0) ready.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location]);

    const handleFormSubmit = (e, publish) => {
        // Replies that arrive after the editor has moved to another location are ignored.
        const later = sessionDispatch(dispatch);
        e.preventDefault();
        remindPendingElsewhere(state, TAB_VIDEO);
        const videosPending = state.videos_pending && state.videos_pending.length > 0 ? state.videos_pending : undefined;
        const posterUpdates = state.posterUpdates_pending || {};
        const pending = !!videosPending || Object.keys(posterUpdates).length > 0;
        const finish = () => {
            setShowLoader(false);
            later({ type: SET_UPLOADING, payload: false });
        };
        const fail = (err) => {
            uploadFailed(err);
            finish();
        };
        const showSaved = (published) => {
            if (published) {
                setIsPublished(true);
                HELPERS.showToast(TOAST_TYPES.SUCCESS, 'Location Published!');
            }
            else {
                HELPERS.showToast(TOAST_TYPES.SUCCESS, 'Update Successful!');
            }
        };
        const startUploading = () => {
            HELPERS.showToast(TOAST_TYPES.INFO, 'Video Upload Started');
            setShowLoader(true);
            later({ type: SET_UPLOADING, payload: true });
        };
        // The upload helpers report through callbacks; a failure must reject, not leave the spinner
        // running forever (B10).
        const upload = (send, files) => new Promise((resolve, reject) => {
            if (files.length === 0) {
                resolve([]);
                return;
            }
            send(files, (res, err) => (res ? resolve(res) : reject(err || new Error('Upload failed'))));
        });
        // Uploads new videos (with their posters) and replacement posters, then saves them. The existing
        // videos come from what the server has just saved, never from this tab's memory, so a video
        // deleted after its poster was changed can't break the save (B10). With Publish, the location
        // only goes live once everything has uploaded.
        const uploadPending = (locationId, savedVideos) => {
            const newVideos = videosPending || [];
            const stillThere = new Set((savedVideos || []).map(video => String(video._id)));
            const posterUpdateIds = Object.keys(posterUpdates).filter(id => stillThere.has(id));
            Promise.all([
                upload(API.uploadVideos, newVideos.map(video => video.video.file)),
                upload(API.uploadImages, newVideos.filter(video => video.poster && video.poster.file).map(video => video.poster.file)),
                upload(API.uploadImages, posterUpdateIds.map(id => posterUpdates[id].file))
            ])
            .then(([videoResponses, posterResponses, posterUpdateResponses]) => {
                const posters = [...posterResponses];
                const uploadedVideos = newVideos.map((video, i) => ({
                    src: videoResponses[i].data.secure_url,
                    ...(video.poster && video.poster.file && { poster: posters.shift().data.secure_url })
                }));
                const existingVideos = (savedVideos || []).map(video => {
                    const i = posterUpdateIds.indexOf(String(video._id));
                    return i >= 0 ? { ...video, poster: posterUpdateResponses[i].data.secure_url } : video;
                });
                const locationVideosRequest = {
                    _id: locationId,
                    detailPageVideos: uploadedVideos.concat(existingVideos),
                    ...(publish && { isPublished: true, isDraft: false })
                };
                API.updateLocation_hideToast(locationVideosRequest, (saved, err) => {
                    if (saved && saved.status === 200) {
                        // Update the editor's shared copy directly, so it is right even if this tab has closed (B3).
                        later({ type: MERGE_PREVIEW, payload: savedFields(saved.data) });
                        setDetailPageVideos(saved.data.detailPageVideos);
                        later({ type: SET_VIDEO_PENDING, payload: undefined });
                        later({ type: SET_POSTER_UPDATES_PENDING, payload: undefined });
                        showSaved(publish);
                        finish();
                    }
                    else {
                        fail(err);
                    }
                });
            })
            .catch(fail);
        };

        const locationId = resolveLocationId(state.previewLocation, history);
        if (locationId) {
            if (pending) startUploading();
            // First save the location as it stands. The server deletes any videos or posters no longer in it.
            const updateRequest = buildSaveRequest(state.previewLocation, locationId, { publish: publish && !pending });
            API.updateLocation_hideToast(updateRequest, (res, err) => {
                if (res && res.status === 200) {
                    later({ type: MERGE_PREVIEW, payload: serverOwnedFields(res.data) });
                    if (pending) {
                        uploadPending(locationId, res.data.detailPageVideos);
                    }
                    else {
                        showSaved(publish);
                    }
                }
                else {
                    console.log(err);
                    finish();
                }
            });
        }
        else {
            if (!canCreate(state.previewLocation)) return;
            if (pending) startUploading();
            API.createLocation(buildCreateRequest(state.previewLocation), (res, err) => {
                if (res && res.status === 200) {
                    // The location exists now: switch to its address straight away, so a failed upload
                    // can't lead to a second copy being created on the next Save.
                    later({ type: MERGE_PREVIEW, payload: serverOwnedFields(res.data) });
                    later.isCurrent() && history.push(`/location/${res.data._id}`);
                    if (pending) {
                        uploadPending(res.data._id, res.data.detailPageVideos);
                    }
                    else {
                        HELPERS.showToast(TOAST_TYPES.SUCCESS, 'Saved as Draft!');
                        later({ type: UPDATE_PREVIEW, payload: res.data });
                    }
                }
                else {
                    console.log(err);
                    finish();
                }
            });
        }
    };

    /**
     * Updates the preview in context, so when it's time to show the preview, data from this tab will be included.
     */
    const updatePreview = () => {
        if (!ready.current) return;
        const previewLocation = {
            ...(detailPageVideos && { detailPageVideos }),
            ...(isPublished != null && { isPublished })
        };
        const payload = {
            ...location,
            ...state.previewLocation,
            ...previewLocation
        };
        dispatch({ type: UPDATE_PREVIEW, payload: payload });
    };

    const handlePublish = (e) => {
        e.preventDefault();
        handleFormSubmit(e, true);
    };

    const resetPosterModal = useCallback(() => {
        setCurrentVideo(undefined);
        setCurrentPoster(undefined);
        setIsEditing(false);
        setEditingIndex(-1);
        setIsEditing_pending(false);
        setEditingIndex_pending(-1);
    }, []);

    const togglePosterModal = useCallback(() => {
        setShowPosterModal((val) => {
            val && resetPosterModal();
            return !val;
        });
    }, [resetPosterModal]);

    const onVideoDrop = useCallback(
        (acceptedFiles) => {
            if (acceptedFiles.length > 0) {
                setCurrentVideo({
                    file: acceptedFiles[0],
                    url: URL.createObjectURL(acceptedFiles[0])
                });
                togglePosterModal();
            }
        },
        [togglePosterModal]
    );

    const onVideoDropRejected = (event) => {
        const message =
            event[0]?.errors[0].code && event[0].errors[0].message
                ? 'Warning! ' +
                  event[0].errors[0].code +
                  ' ' +
                  event[0].errors[0].message
                : 'Warning! Cannot upload file. Video must be .mp4 format and less than 100MB in size';
        HELPERS.showToast(TOAST_TYPES.WARNING, message);
    };

    const onImageDrop = useCallback((acceptedFiles) => {
        if (acceptedFiles.length > 0) {
            compress
                .compress(acceptedFiles, {
                    size: 0.4,
                    quality: 1,
                    maxWidth: 1920,
                    maxHeight: 1080
                })
                .then((data) => {
                    const resizedimage = data[0];
                    const resizedFile = Compress.convertBase64ToFile(resizedimage.data, resizedimage.ext);
                    // reset the poster to undefined then on next render set the poster.
                    // This allows the video element to actually update the poster.
                    setCurrentPoster();
                    requestAnimationFrame(() =>
                        setCurrentPoster({
                            file: resizedFile,
                            url: URL.createObjectURL(resizedFile)
                        })
                    );
                });
        }
    }, []);

    const onImageDropRejected = useCallback((event) => {
        HELPERS.showToast(
            TOAST_TYPES.WARNING,
            'Warning! Cannot upload file because it is not the correct file type! Image must be .jpg or .png'
        );
    }, []);

    const {
        getRootProps: getVideoRootProps,
        getInputProps: getVideoInputProps
    } = useDropzone({
        // No new files while an upload runs: they would be cleared when it finishes.
        disabled: state.uploading,
        onDrop: onVideoDrop,
        onDropRejected: onVideoDropRejected,
        maxFiles: 1,
        maxSize: 100000000,
        accept: 'video/mp4'
    });

    const {
        getRootProps: getImageRootProps,
        getInputProps: getImageInputProps
    } = useDropzone({
        // No new files while an upload runs: they would be cleared when it finishes.
        disabled: state.uploading,
        onDrop: onImageDrop,
        onDropRejected: onImageDropRejected,
        maxFiles: 1,
        accept: 'image/jpeg, image/png'
    });

    const handleEdit = (index) => {
        if (detailPageVideos[index]) {
            setCurrentVideo({ url: detailPageVideos[index].src });
            // A replacement poster still waiting to upload is shown (and kept) when editing again.
            const waitingPoster = (state.posterUpdates_pending || {})[detailPageVideos[index]._id];
            setCurrentPoster(waitingPoster ? { ...waitingPoster } : { url: detailPageVideos[index].poster });
            setIsEditing(true);
            setEditingIndex(index);
            togglePosterModal();
        }
    };

    const handleDelete = (index) => {
        if (window.confirm('Are you sure you want to delete this video?')) {
            const newDetailPageVideos = [...detailPageVideos];
            const [removed] = newDetailPageVideos.splice(index, 1);
            setDetailPageVideos(newDetailPageVideos);
            // A replacement poster waiting for this video is no longer needed.
            const updates = { ...(state.posterUpdates_pending || {}) };
            if (removed && updates[removed._id]) {
                delete updates[removed._id];
                dispatch({ type: SET_POSTER_UPDATES_PENDING, payload: Object.keys(updates).length > 0 ? updates : undefined });
            }
        }
    };

    const handleReorder = (index) => {
        console.log('index :>> ', index);
    };

    const handleUpdatePoster = () => {
        if (isEditing) {
            const video = detailPageVideos[editingIndex];
            const updates = { ...(state.posterUpdates_pending || {}) };
            if (currentPoster?.file) {
                // A new poster waits here as a file until Save uploads it. The video keeps its stored
                // poster until then: the browser-only preview link must never be saved (B4).
                updates[video._id] = { file: currentPoster.file, url: currentPoster.url };
            } else {
                // Poster removed, or left as it was.
                delete updates[video._id];
                const newDetialPageVideos = [...detailPageVideos];
                newDetialPageVideos.splice(editingIndex, 1, { _id: video._id, src: video.src, poster: currentPoster?.url });
                setDetailPageVideos(newDetialPageVideos);
            }
            dispatch({ type: SET_POSTER_UPDATES_PENDING, payload: Object.keys(updates).length > 0 ? updates : undefined });
            togglePosterModal();
        } else if (isEditing_pending) {
            const newVideo = {
                video: currentVideo,
                poster: {
                    file: currentPoster?.file,
                    url: currentPoster?.url
                }
            };
            const newVideos_pending = [...state.videos_pending];
            newVideos_pending.splice(editingIndex_pending, 1, newVideo);
            dispatch({ type: SET_VIDEO_PENDING, payload: newVideos_pending });
            togglePosterModal();
        }
    };

    const handleAddPoster = () => {
        const newVideo = {
            video: {
                file: currentVideo.file,
                url: currentVideo.url
            },
            poster: {
                file: currentPoster?.file,
                url: currentPoster?.url
            }
        };
        let newVideos_pending = [];
        if (state.videos_pending) {
            newVideos_pending = [...state.videos_pending];
        }
        newVideos_pending.push(newVideo);
        dispatch({
            type: SET_VIDEO_PENDING,
            payload: newVideos_pending
        });
        togglePosterModal();
    };

    const handlePendingEdit = (index) => {
        if (state.videos_pending[index]) {
            setCurrentVideo(state.videos_pending[index].video);
            setCurrentPoster(state.videos_pending[index].poster);
            setIsEditing_pending(true);
            setEditingIndex_pending(index);
            togglePosterModal();
        }
    };

    const handlePendingDelete = (index) => {
        if (window.confirm('Are you sure you want to delete this video?')) {
            const newVideos_pending = [...state.videos_pending];
            newVideos_pending.splice(index, 1);
            dispatch({ type: SET_VIDEO_PENDING, payload: newVideos_pending });
        }
    };

    return (
        <div className='VideoTabView'>
            <TabView
                header={`Video Upload ${
                    state.previewLocation.name
                        ? '- ' + state.previewLocation.name
                        : ''
                }`}
                description="This section allows you to upload videos for display on this location's page. Additionally, you have the option to assign a poster image, which will be presented to viewers before they begin playing the video."
                previousView={TAB_MEDIA}
                nextView={TAB_PAYMENT}
                formId='videoForm'
                isPublished={isPublished}
                updatePreview={updatePreview}
                onPublish={handlePublish}
            >
                <div className='card editDetailCard p-4'>
                    <form id='videoForm' onSubmit={handleFormSubmit}>
                        <div {...getVideoRootProps()} className='dropzone'>
                            <input {...getVideoInputProps()} />
                            <div className='d-flex flex-column align-items-center justify-content-around h-100 py-5 bg-light'>
                                <i className='fas fa-cloud-upload-alt largeText'></i>
                                <h3>Drop Files Here</h3>
                                <p className='text-secondary fw-bold'>
                                    File type must be .mp4 - Max file size is 100MB
                                </p>
                                <button
                                    type='button'
                                    className='btn btn-outline-primary'
                                >
                                    Browse
                                </button>
                            </div>
                        </div>
                        {state.videos_pending?.length > 0 && (
                            <>
                                <h5 className='mt-5'>Videos Pending Save</h5>
                                <p>
                                    The following videos will be uploaded once
                                    the location is saved with the <b>Save</b>{' '}
                                    button below.
                                </p>
                                <div className='row'>
                                    {state.videos_pending.map(
                                        (video, index) => (
                                            <div
                                                className='col-12 col-lg-6 mb-4'
                                                key={index}
                                            >
                                                <VideoCard
                                                    src={video.video.url}
                                                    poster={video?.poster?.url}
                                                    onEdit={() =>
                                                        handlePendingEdit(index)
                                                    }
                                                    onDelete={() =>
                                                        handlePendingDelete(
                                                            index
                                                        )
                                                    }
                                                />
                                            </div>
                                        )
                                    )}
                                </div>
                            </>
                        )}
                        <h5 className='mt-5'>Videos</h5>
                        <p>
                            This section features the videos displayed on the
                            location detail page. You have the flexibility to
                            edit a video's poster image, remove existing videos,
                            and upload new ones using the upload tool provided
                            above.
                        </p>
                        {!detailPageVideos ||
                        detailPageVideos & (detailPageVideos.length === 0) ? (
                            <p className='text-secondary pt-5'>
                                Currently no location videos have been added.
                                Upload videos with the upload tool above.
                            </p>
                        ) : (
                            <div className='row'>
                                {detailPageVideos.map((video, index) => (
                                    <div
                                        className='col-12 col-lg-6 mb-4'
                                        key={index}
                                    >
                                        <VideoCard
                                            src={video.src}
                                            poster={((state.posterUpdates_pending || {})[video._id] || {}).url || video.poster}
                                            onEdit={() => handleEdit(index)}
                                            onDelete={() => handleDelete(index)}
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                        {showLoader && (
                            <div className='d-flex justify-content-center align-items-center'>
                                <div className='spinner-border' role='status'>
                                    <span className='visually-hidden'>
                                        Loading...
                                    </span>
                                </div>
                            </div>
                        )}
                    </form>
                </div>
            </TabView>
            <Modal
                isOpen={showPosterModal}
                toggle={togglePosterModal}
                centered
                size='xl'
            >
                <ModalHeader>
                    {`${
                        isEditing || isEditing_pending ? 'Edit' : 'Add'
                    } Video Poster`}
                </ModalHeader>
                <ModalBody>
                    {
                        <>
                            <div {...getImageRootProps()} className='dropzone'>
                                <input {...getImageInputProps()} />
                                <div className='d-flex flex-column align-items-center justify-content-around h-100 py-5 bg-light'>
                                    <i className='fas fa-cloud-upload-alt largeText'></i>
                                    <h3>Drop Files Here</h3>
                                    <p className='text-secondary fw-bold'>
                                        File type must be .jpg or .png
                                    </p>
                                    <button
                                        type='button'
                                        className='btn btn-outline-primary'
                                    >
                                        Browse
                                    </button>
                                </div>
                            </div>
                            <p className='pt-2'>
                                Video posters are captivating images that entice
                                viewers before they commence watching a video.
                                These posters can enhance the visual appeal of
                                your content. If you choose not to select a
                                custom poster, the <b>video's initial frame</b>{' '}
                                will serve as the visual preview in the player
                                before users press play.
                            </p>
                            <p className='p-4 mt-3 bg-warning rounded-3'>
                                <b className='fst-italic'>Note:</b> For optimal
                                results, opt for an image with a 16:9 aspect
                                ratio to match the video's dimensions.
                            </p>
                            <VideoCard
                                src={currentVideo?.url}
                                poster={currentPoster?.url}
                                {...(currentPoster && {
                                    onDelete: () => setCurrentPoster(undefined)
                                })}
                            />
                            {currentPoster && (
                                <p className='mt-2'>
                                    To remove the poster image, simply click on
                                    the delete icon located at the bottom left
                                    of the video panel. Rest assured, this
                                    action only removes the poster image and not
                                    the video itself. Once you are content with
                                    your modifications, proceed by clicking the{' '}
                                    {isEditing || isEditing_pending ? (
                                        <b>Update</b>
                                    ) : (
                                        <b>Add</b>
                                    )}{' '}
                                    button.
                                </p>
                            )}
                        </>
                    }
                </ModalBody>
                <ModalFooter>
                    <button className='btn' onClick={togglePosterModal}>
                        CANCEL
                    </button>
                    {isEditing || isEditing_pending ? (
                        <button
                            className='btn btn-primary'
                            onClick={handleUpdatePoster}
                        >
                            Update
                        </button>
                    ) : (
                        <button
                            className='btn btn-primary'
                            onClick={handleAddPoster}
                        >
                            {currentPoster ? 'Add' : 'Skip'}
                        </button>
                    )}
                </ModalFooter>
            </Modal>
        </div>
    );
};

export default VideoTabView;
