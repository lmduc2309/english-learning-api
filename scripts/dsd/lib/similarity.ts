/**
 * Re-export of the similarity module, which lives in src.
 *
 * It is pure and deterministic — no I/O, no connections — so it belongs beside
 * the quality module in src, where the release audit can import it without
 * dragging operator tooling into the production build. This file keeps the
 * scripts-side import path stable.
 */
export * from '../../../src/dsd-corpus/similarity/similarity';
