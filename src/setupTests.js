// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Packages Jest can't load (ESM-only, or map/video rendering). None of them is exercised by tests.
jest.mock('compress.js', () => jest.fn());
jest.mock('react-player', () => () => null);
jest.mock('./components/coordinatePicker/CoordinatePicker', () => () => null);
