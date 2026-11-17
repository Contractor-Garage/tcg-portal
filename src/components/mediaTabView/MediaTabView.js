import React, { useCallback, useContext, useEffect, useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { TAB_MEDIA, TAB_UNIT, TAB_VIDEO } from '../../shared/Constants';
import { HELPERS, TOAST_TYPES } from '../../util/helpers';
import { buildCreateRequest, buildSaveRequest, canCreate, remindPendingElsewhere, resolveLocationId, savedFields, serverOwnedFields, sessionDispatch, uploadFailed } from '../../util/locationSave';
import TabView from '../tabView/TabView';
import './MediaTabView.sass';
import Compress from 'compress.js';
import { API } from '../../util/API';
import { AppContext } from '../../context/Store';
import { MERGE_PREVIEW, SET_BANNER_IMAGE_PENDING, SET_DETAIL_PAGE_IMAGES_PENDING, SET_UPLOADING, UPDATE_PREVIEW } from '../../context/ActionTypes';
import ImageCard from '../imageCard/ImageCard';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';
import { useHistory } from 'react-router-dom';

const MediaTabView = ({location}) => {
    const [state, dispatch] = useContext(AppContext);
    const history = useHistory();

    const [detailPageImages, setDetailPageImages] = useState();
    const [bannerImage, setBannerImage] = useState();
    const [isPublished, setIsPublished] = useState();
    // True once the location has loaded into this tab (see GeneralTabView). Until then the tab must not
    // write its blank starting values, which a Save would treat as removing the image.
    const ready = useRef(false);

    // State for new image object being created before it is uploaded
    const [currentImage, setCurrentImage] = useState();
    const [currentCaption, setCurrentCaption] = useState();
    const [isEditing_pending, setIsEditing_pending] = useState(false);
    const [editingIndex_pending, setEditingIndex_pending] = useState(-1);

    // Editing Modal state
    const [captionModal, setCaptionModal] = useState(false);
    const [captionModalPage, setCaptionModalPage] = useState(1);
    const [isEditing, setIsEditing] = useState(false);
    const [editingIndex, setEditingIndex] = useState(-1);

    // Reorder Modal State
    const [reorderModal, setReorderModal] = useState(false);
    const [newOrderIndex, setNewOrderIndex] = useState(-1);

    const compress = new Compress();
    /**
     * Every time a field changes update the preview so when this tab is exited the preview retains its data.
     */
    useEffect(() => {
        updatePreview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detailPageImages, bannerImage, isPublished]);

    useEffect(() => {
        const locationWithChanges = {
            ...location,
            ...state.previewLocation
        };
        setDetailPageImages(locationWithChanges.detailPageImages ? locationWithChanges.detailPageImages : '');
        setBannerImage(locationWithChanges.bannerImage ? locationWithChanges.bannerImage : undefined);
        setIsPublished(locationWithChanges.isPublished ? locationWithChanges.isPublished: null);
        if (Object.keys(location).length > 0) ready.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location]);
    
    const handleFormSubmit = (e, publish) => {
        // Replies that arrive after the editor has moved to another location are ignored.
        const later = sessionDispatch(dispatch);
        e.preventDefault();
        remindPendingElsewhere(state, TAB_MEDIA);
        const bannerPending = state.bannerImage_pending && state.bannerImage_pending.file ? state.bannerImage_pending : undefined;
        const imagesPending = state.detailPageImages_pending && state.detailPageImages_pending.length > 0 ? state.detailPageImages_pending : undefined;
        const pending = !!(bannerPending || imagesPending);
        const doneUploading = () => later({type: SET_UPLOADING, payload: false});
        const showSaved = (published) => {
            if (published) {
                setIsPublished(true);
                HELPERS.showToast(TOAST_TYPES.SUCCESS, 'Location Published!');
            }
            else {
                HELPERS.showToast(TOAST_TYPES.SUCCESS, 'Update Successful!');
            }
        };
        // Uploads the waiting images and stores them: a new banner replaces the old one, new gallery images
        // go before the gallery the server has just saved. With Publish, the location only goes live once
        // the upload has worked.
        const uploadPending = (locationId, savedGallery) => {
            const files = [];
            const locationImageRequest = { _id: locationId, ...(publish && { isPublished: true, isDraft: false }) };
            if (bannerPending) {
                files.push(bannerPending.file);
                locationImageRequest.bannerImage = { src: '', alt: state.previewLocation.name + ' banner image' };
            }
            if (imagesPending) {
                locationImageRequest.detailPageImages = imagesPending.map(image => {
                    files.push(image.file);
                    return { src: '', thumbnail: '', alt: image.alt };
                });
            }
            API.uploadImages(files, (uploaded, err) => {
                if (!uploaded) {
                    uploadFailed(err);
                    doneUploading();
                    return;
                }
                const results = [...uploaded];
                if (locationImageRequest.bannerImage) {
                    locationImageRequest.bannerImage.src = results.shift().data.secure_url;
                }
                if (locationImageRequest.detailPageImages) {
                    locationImageRequest.detailPageImages.forEach((image, i) => {
                        image.src = results[i].data.secure_url;
                        image.thumbnail = results[i].data.secure_url;
                    });
                    locationImageRequest.detailPageImages = locationImageRequest.detailPageImages.concat(savedGallery || []);
                }
                API.updateLocation_hideToast(locationImageRequest, (saved, err) => {
                    if (saved && saved.status === 200) {
                        // Update the editor's shared copy directly, so it is right even if this tab has closed (B3).
                        later({type: MERGE_PREVIEW, payload: savedFields(saved.data)});
                        if (locationImageRequest.bannerImage) {
                            setBannerImage(saved.data.bannerImage);
                            later({type: SET_BANNER_IMAGE_PENDING, payload: undefined});
                        }
                        if (locationImageRequest.detailPageImages) {
                            setDetailPageImages(saved.data.detailPageImages);
                            later({type: SET_DETAIL_PAGE_IMAGES_PENDING, payload: undefined});
                        }
                        showSaved(publish);
                    }
                    else {
                        uploadFailed(err);
                    }
                    doneUploading();
                });
            });
        };

        const locationId = resolveLocationId(state.previewLocation, history);
        if (locationId) {
            if (pending) later({type: SET_UPLOADING, payload: true});
            // First save the location as it stands. The server deletes any images no longer in it.
            const updateRequest = buildSaveRequest(state.previewLocation, locationId, { publish: publish && !pending });
            API.updateLocation_hideToast(updateRequest, (res, err) => {
                if (res && res.status === 200) {
                    later({type: MERGE_PREVIEW, payload: serverOwnedFields(res.data)});
                    if (pending) {
                        uploadPending(locationId, res.data.detailPageImages);
                    }
                    else {
                        showSaved(publish);
                    }
                }
                else {
                    console.log(err);
                    doneUploading();
                }
            });
        }
        else {
            if (!canCreate(state.previewLocation)) return;
            if (pending) later({type: SET_UPLOADING, payload: true});
            API.createLocation(buildCreateRequest(state.previewLocation), (res, err) => {
                if (res && res.status === 200) {
                    // The location exists now: switch to its address straight away, so a failed upload
                    // can't lead to a second copy being created on the next Save.
                    later({type: MERGE_PREVIEW, payload: serverOwnedFields(res.data)});
                    later.isCurrent() && history.push(`/location/${res.data._id}`);
                    if (pending) {
                        uploadPending(res.data._id, res.data.detailPageImages);
                    }
                    else {
                        HELPERS.showToast(TOAST_TYPES.SUCCESS, 'Update Successful!');
                        later({type: UPDATE_PREVIEW, payload: res.data});
                    }
                }
                else {
                    console.log(err);
                    doneUploading();
                }
            });
        }
    }

    const handlePublish = (e) => {
        e.preventDefault();
        handleFormSubmit(e, true);
    }
    /**
     * Updates the preview in context so when it is time to show the preview data from this tab will be included.
     */
    const updatePreview = () => {
        if (!ready.current) return;
        const previewLocation = {
            ...(detailPageImages) && {detailPageImages},
            bannerImage,
            ...((isPublished != null) && {isPublished})
        };
        const payload = {
            ...location,
            ...state.previewLocation,
            ...previewLocation
        };
        dispatch({type: UPDATE_PREVIEW, payload: payload});
    }
    
    const onDrop = useCallback(acceptedFiles => {
        if (acceptedFiles.length > 0) {
            console.log('accpetedFiles :>> ', acceptedFiles);
            compress.compress(acceptedFiles, {
                size: .4,
                quality: 1,
                maxWidth: 1920,
                maxHeight: 1080
            })
            .then(data => {
                const resizedimage = data[0];
                const resizedFile = Compress.convertBase64ToFile(resizedimage.data, resizedimage.ext);
                console.log(resizedFile);
                setCurrentImage(resizedFile);

                // Open caption modal
                toggleCaptionModal();
            })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onDropRejected = event => {
        console.log(event);
        HELPERS.showToast(TOAST_TYPES.WARNING, 'Warning! Cannot upload file because it is not the correct file type! Image must be .jpg or .png');
    }

    const { getRootProps, getInputProps } = useDropzone({
        // No new files while an upload runs: they would be cleared when it finishes.
        disabled: state.uploading,
        onDrop,
        onDropRejected,
        maxFiles: 1,
        accept: 'image/jpeg, image/png'
    });
    
    const toggleCaptionModal = () => {
        if (captionModal) {
            resetCaptionModal();
        }
        setCaptionModal(!captionModal);
    }
    
    const resetCaptionModal = () => {
        setCurrentCaption('');
        setIsEditing(false);
        setEditingIndex(-1);
        setCaptionModalPage(1);
        setIsEditing_pending(false);
        setEditingIndex_pending(-1);
    }

    const toggleReorderModal = () => {
        if (reorderModal) {
            resetReorderModal();
        }
        setReorderModal(!reorderModal);
    }

    const resetReorderModal = () => {
        setEditingIndex(-1);
        setNewOrderIndex(-1);
    }
    
    const handleBannerClick_modalPage = () => {
        const newBannerImage = {
            ...(currentImage && {file: currentImage}),
            ...(currentImage && {src: URL.createObjectURL(currentImage)})
        };
        dispatch({type: SET_BANNER_IMAGE_PENDING, payload: newBannerImage});
        toggleCaptionModal();
    }

    const handleLocaionImageClick_modalPage = () => {
        setCaptionModalPage(2);
    }

    const handleEdit = index => {
        if (detailPageImages[index]) {
            setCurrentCaption(detailPageImages[index].alt);
            setIsEditing(true);
            setEditingIndex(index);
            setCaptionModalPage(2);
            toggleCaptionModal();
        }
    }

    const handleDelete = index => {
        if (window.confirm('Are you sure you want to delete this image?')) {
            const newDetailPageImages = [...detailPageImages];
            newDetailPageImages.splice(index, 1);
            setDetailPageImages(newDetailPageImages);
        }
    }

    const handleReorder = index => {
        setEditingIndex(index);
        setNewOrderIndex(index);
        toggleReorderModal();
    }

    const handleBanner_pendingDelete = () => {
        if (window.confirm('Are you sure you want to delete this banner image?')) {
            dispatch({type: SET_BANNER_IMAGE_PENDING, payload: undefined});
        }
    }

    const handleUpdateCaption = () => {
        if (isEditing) {
            const newDetailPageImage = {
                ...(currentCaption && {alt: currentCaption}),
                ...(detailPageImages[editingIndex].src && {src: detailPageImages[editingIndex].src}),
                ...(detailPageImages[editingIndex].thumbnail && {thumbnail: detailPageImages[editingIndex].thumbnail})
            };
            const newDetailPageImages = [...detailPageImages];
            newDetailPageImages.splice(editingIndex, 1, newDetailPageImage);
            setDetailPageImages(newDetailPageImages);
            toggleCaptionModal();
        }
        else if (isEditing_pending) {
            const newDetailPageImage = {
                ...(currentCaption && {alt: currentCaption}),
                ...(state.detailPageImages_pending[editingIndex_pending].src && {src: state.detailPageImages_pending[editingIndex_pending].src}),
                ...(state.detailPageImages_pending[editingIndex_pending].file && {file: state.detailPageImages_pending[editingIndex_pending].file})
            };
            const newDetailPageImages_pending = [...state.detailPageImages_pending];
            newDetailPageImages_pending.splice(editingIndex_pending, 1, newDetailPageImage);
            dispatch({type: SET_DETAIL_PAGE_IMAGES_PENDING, payload: newDetailPageImages_pending});
            toggleCaptionModal();
        }
    }
    
    const handleAddCaption = () => {
        const newDetailPageImage = {
            ...(currentCaption && {alt: currentCaption}),
            ...(currentImage && {file: currentImage}),
            ...(currentImage && {src: URL.createObjectURL(currentImage)})
        };
        let newDetailPageImages_pending = [];
        if (state.detailPageImages_pending) {
            newDetailPageImages_pending = [...state.detailPageImages_pending];
        }
        newDetailPageImages_pending.push(newDetailPageImage);
        dispatch({type: SET_DETAIL_PAGE_IMAGES_PENDING, payload: newDetailPageImages_pending});
        toggleCaptionModal();
    }

    const handleReorderFinalize = () => {
        const item = detailPageImages.splice(editingIndex, 1)[0];
        detailPageImages.splice(newOrderIndex, 0, item);
        toggleReorderModal();
    }

    const handlePendingEdit = index => {
        if (state.detailPageImages_pending[index]) {
            setCurrentCaption(state.detailPageImages_pending[index].alt);
            setIsEditing_pending(true);
            setEditingIndex_pending(index);
            setCaptionModalPage(2);
            toggleCaptionModal();
        }
    }

    const handlePendingDelete = index => {
        if (window.confirm('Are you sure you want to delete this image?')) {
            const newDetailPageImages_pending = [...state.detailPageImages_pending];
            newDetailPageImages_pending.splice(index, 1);
            dispatch({type: SET_DETAIL_PAGE_IMAGES_PENDING, payload: newDetailPageImages_pending});
        }
    }

    return (
        <div className='MediaTabView'>
            <TabView
                header={`Image Upload ${state.previewLocation.name ? '- ' + state.previewLocation.name : ''}`}
                description='This section is for uploading image media which can have optional caption text that will be shown with the image.'
                previousView={TAB_UNIT}
                nextView={TAB_VIDEO}
                formId='mediaForm'
                isPublished={isPublished}
                updatePreview={updatePreview}
                onPublish={handlePublish}
            >
                <div className='card editDetailCard p-4'>
                    <form id='mediaForm' onSubmit={handleFormSubmit}>
                        <div {...getRootProps()} className='dropzone'>
                            <input {...getInputProps()} />
                            <div className="d-flex flex-column align-items-center justify-content-around h-100 py-5 bg-light">
                                <i className="fas fa-cloud-upload-alt largeText"></i>
                                <h3>Drop Files Here</h3>
                                <p className='text-secondary fw-bold'>File types must be .jpg or .png</p>
                                <button type="button" className="btn btn-outline-primary">Browse</button>
                            </div>
                        </div>
                        {
                            ((state.detailPageImages_pending && state.detailPageImages_pending.length > 0) || state.bannerImage_pending) &&
                            <>
                                <h5 className="mt-5">Images Pending Save</h5>
                                <p>The following images will be uploaded once the location is saved with the <b>Save</b> button below. Banner images uploaded here will replace any existing banner image shown below.</p>
                                <div className="row">
                                    {
                                        state.bannerImage_pending &&
                                        <div className="col-12 mb-4">
                                            <ImageCard
                                                src={state.bannerImage_pending.src}
                                                caption='Banner'
                                                hideEdit
                                                onDelete={handleBanner_pendingDelete}
                                            />
                                        </div>
                                    }
                                    {
                                        state.detailPageImages_pending && state.detailPageImages_pending.map((image, index) => (
                                            <div className="col-12 col-lg-6 mb-4" key={index}>
                                                <ImageCard
                                                    src={image.src}
                                                    caption={image.alt}
                                                    onEdit={() => handlePendingEdit(index)}
                                                    onDelete={() => handlePendingDelete(index)}
                                                />
                                            </div>
                                        ))
                                    }
                                </div>
                            </>
                        }
                        <h5 className='mt-5'>Banner Image</h5>
                        <p>An optional banner image can be shown at the top of the page for each location. To change this image use the upload tool above and select <b>Banner Image</b> after uploading image. This new image will replace the current banner image once the location is saved.</p>
                        {
                            bannerImage
                            ?
                            <div
                                className="bannerImage card rounded-0 rounded-top"
                                style={{
                                    backgroundImage: `url(${bannerImage.src})`,
                                    backgroundPosition: 'center',
                                    backgroundRepeat: 'no-repeat',
                                    backgroundSize: 'cover',
                                    height: '30vh'
                                }}
                            >
                                <div className="card-footer position-relative rounded-bottom border">
                                    <button type='button' className="btn btn-link text-danger" onClick={() => {
                                        if (window.confirm('Are you sure you want to delete this banner image?')) {
                                            setBannerImage();
                                        }
                                    }}>
                                        <i className="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            </div>
                            :
                            <p className="text-secondary pt-5">Currently no banner image has been added. Upload an image with the upload tool above.</p>
                        }
                        <h5 className='mt-5'>Location Images</h5>
                        <p>These are the images that are shown in the slider at the bottom of the location detail page. Here you can edit the caption text, delete images, and upload new ones using the upload tool above.</p>
                        {
                            !detailPageImages || (detailPageImages && detailPageImages.length === 0)
                            ?
                            <p className="text-secondary pt-5">Currently no location images have been added. Upload images with the upload tool above.</p>
                            :
                            <div className="row">
                                {
                                    detailPageImages.map((image, index) => (
                                        <div className="col-12 col-lg-6 mb-4" key={index}>
                                            <ImageCard
                                                src={image.src}
                                                caption={image.alt}
                                                onEdit={() => handleEdit(index)}
                                                onDelete={() => handleDelete(index)}
                                                onReorder={() => handleReorder(index)}
                                            />
                                        </div>
                                    ))
                                }
                            </div>
                        }
                    </form>
                </div>
            </TabView>
            <Modal isOpen={captionModal} toggle={toggleCaptionModal} centered>
                <ModalHeader>
                    {
                        captionModalPage === 1
                        ?
                        'Select Image Type'
                        :
                        `${isEditing ? 'Edit' : 'Add'} Caption Text`
                    }
                </ModalHeader>
                <ModalBody>
                    {
                        captionModalPage === 1
                        ?
                        <div className='text-center'>
                            <p>What type of image is this?</p>
                            <button className="btn btn-outline-primary me-3" type='button' onClick={handleBannerClick_modalPage}>Banner Image</button>
                            <button className="btn btn-outline-primary" type='button' onClick={handleLocaionImageClick_modalPage}>Location Image</button>
                        </div>
                        :
                        <>
                            <label htmlFor="caption" className="form-label">Image Caption</label>
                            <textarea
                                id="caption"
                                className='form-control'
                                rows="4"
                                placeholder='Enter Caption'
                                value={currentCaption}
                                onChange={e => setCurrentCaption(e.target.value)}
                            />
                        </>
                    }
                </ModalBody>
                <ModalFooter>
                    <button className="btn" onClick={toggleCaptionModal}>CANCEL</button>
                    {
                        captionModalPage === 2 &&
                        (isEditing || isEditing_pending
                        ?
                        <button className="btn btn-primary" onClick={handleUpdateCaption}>Update</button>
                        :
                        <button className="btn btn-primary" onClick={handleAddCaption}>Add</button>)
                    }
                </ModalFooter>
            </Modal>
            <Modal isOpen={reorderModal} toggle={toggleReorderModal} centered size='lg'>
                <ModalHeader>Reorder Image</ModalHeader>
                <ModalBody>
                    <p>
                        Change the position of this image in the order of items in the image carousel.
                    </p>
                    <p>
                        <b>Set First</b> and <b>Set Last</b> will move this image to the front or back respectively.
                    </p>
                    <p>
                        <b>Move Forward</b> and <b>Move Back</b> will move this image one position forward or back.
                    </p>
                    <h5 className='text-center'>
                        Current Image Position: <span className='text-success'>{newOrderIndex + 1}</span> / {detailPageImages && detailPageImages.length}
                    </h5>
                    <div className='text-center'>
                        <button
                            className="btn btn-outline-primary me-3" type='button'
                            onClick={() => setNewOrderIndex(0)}
                            disabled={newOrderIndex === 0}
                        >Set First</button>
                        <button
                            className="btn btn-outline-primary me-3" type='button'
                            onClick={() => setNewOrderIndex(newOrderIndex - 1)}
                            disabled={newOrderIndex === 0}
                        >Move Forward</button>
                        <button
                            className="btn btn-outline-primary me-3" type='button'
                            onClick={() => setNewOrderIndex(newOrderIndex + 1)}
                            disabled={newOrderIndex === (detailPageImages && detailPageImages.length) - 1}
                        >Move Back</button>
                        <button
                            className="btn btn-outline-primary" type='button'
                            onClick={() => setNewOrderIndex(detailPageImages.length - 1)}
                            disabled={newOrderIndex === (detailPageImages && detailPageImages.length) - 1}
                        >Set Last</button>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button className="btn" onClick={toggleReorderModal}>CANCEL</button>
                    <button className="btn btn-primary" onClick={handleReorderFinalize}>OK</button>
                </ModalFooter>
            </Modal>
        </div>
    );
};

export default MediaTabView;