/**
 * The public site's imagery, imported once.
 *
 * These live under `src/assets/` rather than in `public/` on purpose: Vite
 * then fingerprints each file, so a changed photograph cannot be served from
 * a stale cache, and a missing one fails the BUILD rather than 404ing in a
 * citizen's browser.
 *
 * The five sector photographs are illustrations, and each carries an
 * "ILLUSTRATION" badge burned into the image itself. That badge is the honest
 * part and must not be cropped out — nothing here is a photograph of an
 * actual GDB borrower, because there are none yet.
 */
export { default as coatOfArms } from '../../assets/landing/coat-of-arms.png';
export { default as ministryOfFinance } from '../../assets/landing/ministry-of-finance.png';
export { default as presidentPortrait } from '../../assets/landing/president-portrait.png';
export { default as sectorAgriculture } from '../../assets/landing/sector-agriculture.png';
export { default as sectorTourism } from '../../assets/landing/sector-tourism.png';
export { default as sectorManufacturing } from '../../assets/landing/sector-manufacturing.png';
export { default as sectorTechnology } from '../../assets/landing/sector-technology.png';
export { default as sectorOrangeCare } from '../../assets/landing/sector-orange-care.png';
