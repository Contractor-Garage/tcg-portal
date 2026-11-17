import React, { useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';
import { OPEN_PREVIEW, RESET_PREVIEW, SET_TABVIEW } from '../../context/ActionTypes';
import { AppContext } from '../../context/Store';
import { API } from '../../util/API';
import { HELPERS } from '../../util/helpers';

const TabView = props => {
    const [state, dispatch] = useContext(AppContext);
    const routeLocation = useLocation();
    const locationId = routeLocation.pathname.split('/location/')[1];
    const [previewModal, setPreviewModal] = useState(false);
    const [previewHref, setPreviewHref] = useState('');


    useEffect(() => {
        if (state.openPreview) {
            API.createPreview({data: JSON.stringify(state.previewLocation)}, (res, err) => {
                if (res && res.status === 200) {
                    setPreviewHref('https://contractorsgarage.com/location/preview/' + res.data._id);
                    togglePreviewModal();
                    dispatch({type: RESET_PREVIEW});
                }
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.openPreview]);
    
    const togglePreviewModal = () => setPreviewModal(!previewModal);
    
    const handleTabViewNavClick = (e, tabView) => {
        e.preventDefault();
        // Switching tabs mid-upload used to lose track of the new files (B3), so wait until it finishes.
        if (state.uploading) return;
        dispatch({type: SET_TABVIEW, payload: tabView})
    }

    /**
     * Publish runs the tab's normal save with the form as the event target, so the form is checked
     * for invalid fields first and errors (like a taken URL slug) show on the right field (B13).
     */
    const handlePublishClick = (e) => {
        e.preventDefault();
        const form = document.getElementById(props.formId);
        props.onPublish({ target: form, currentTarget: form, preventDefault: () => {}, stopPropagation: () => {} });
    }

    const handlePreviewClick = () => {
        props.updatePreview();
        dispatch({type: OPEN_PREVIEW});
    }

    return (
        <div className='TabView'>
            <div className="mb-5 pb-5">
                <h2 className='my-4'>{props.header}{props.statusBadge}</h2>
                <p>{props.description}</p>
                {props.children}
                <div className="card p-4 mt-4">
                    <div>
                        {
                            locationId === 'new'
                            ?
                                <button form={props.formId} type='submit' className="btn btn-primary" disabled={state.uploading}>Save As Draft</button>
                            :
                            <>
                                <button form={props.formId} type='submit' className="btn btn-primary" disabled={state.uploading}>Save</button>
                                {
                                    !props.isPublished && 
                                    <button
                                        form={props.formId}
                                        type='submit'
                                        className="btn btn-primary ms-2"
                                        onClick={handlePublishClick}
                                        disabled={state.uploading}
                                    >
                                        Publish
                                    </button>
                                }
                                <button className="btn btn-secondary ms-2" onClick={handlePreviewClick} disabled={state.uploading}>Create Preview</button>
                            </>
                        }
                    </div>
                    {
                        state.uploading &&
                        <p className='mt-3 mb-0 fw-bold'>Uploading files... Please stay on this tab until the upload finishes.</p>
                    }
                </div>
                <div className="tabViewNavSection d-flex justify-content-between my-5">
                    {
                        props.previousView &&
                        <div className='card p-3'>
                            <a
                                href='/'
                                className={state.uploading ? 'text-muted' : undefined}
                                aria-disabled={state.uploading}
                                onClick={e => handleTabViewNavClick(e, props.previousView)}
                            >
                                <i className="fas fa-arrow-left"></i> Previous: {HELPERS.getTabNameFromTabView(props.previousView)}
                            </a>
                        </div>
                    }
                    {
                        props.nextView &&
                        <div className='ms-auto card p-3'>
                            <a
                                href='/'
                                className={state.uploading ? 'text-muted' : undefined}
                                aria-disabled={state.uploading}
                                onClick={e => handleTabViewNavClick(e, props.nextView)}
                            >
                                Next: {HELPERS.getTabNameFromTabView(props.nextView)} <i className="fas fa-arrow-right"></i>
                            </a>
                        </div>
                    }
                </div>
            </div>
            <Modal isOpen={previewModal} toggle={togglePreviewModal}>
                <ModalHeader>Location Preview Generated</ModalHeader>
                <ModalBody>
                    <p>A preview has been generated from your data for this location. The link below will open the preview in a new tab. <b>This link will expire in 30 minutes.</b></p>
                    <a href={previewHref} target='_blank' rel="noopener noreferrer">View Preview <i className="fas fa-external-link-alt"></i></a>
                </ModalBody>
                <ModalFooter>
                    <button className="btn btn-primary" onClick={togglePreviewModal}>Close</button>
                </ModalFooter>
            </Modal>
        </div>
    );
};

export default TabView;