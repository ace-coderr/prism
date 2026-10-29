/**
 * Compile-time proof that an example can't stand in for a real record. Never imported: `tsc`
 * checks it, nothing bundles it. If one of these stops being an error, an example could be passed
 * where a real review, X-ray or creator card is expected.
 */
import type { CreatorSold } from '../data/api';
import type { ReviewView, Xray } from '@prism/core';
import type { ExampleCreatorSold, ExampleReview, ExampleXray } from './data';

declare const exampleReview: ExampleReview;
declare const exampleXray: ExampleXray;
declare const exampleCreator: ExampleCreatorSold;
declare const realReview: ReviewView;
declare const realCreator: CreatorSold;
declare const realXray: Xray;

// @ts-expect-error an example is not a review
export const a: ReviewView = exampleReview;
// @ts-expect-error an example is not an X-ray
export const b: Xray = exampleXray;
// @ts-expect-error an example is not a creators-selling row
export const c: CreatorSold = exampleCreator;
// @ts-expect-error a real review can't be passed where an example is expected either
export const d: ExampleReview = realReview;
// @ts-expect-error nor a real creators-selling row
export const e: ExampleCreatorSold = realCreator;
// @ts-expect-error nor a real X-ray
export const f: ExampleXray = realXray;
// @ts-expect-error the id is a string, never a review number
export const g: ReviewView['id'] = exampleReview.id;
