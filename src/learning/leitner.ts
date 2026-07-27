export type ReviewRating = 'again' | 'hard' | 'easy';

const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];

export function scheduleReview(stage: number, rating: ReviewRating, now = new Date()) {
  const currentStage = Math.max(0, Math.min(5, stage));
  const nextStage = rating === 'again' ? 0 : rating === 'hard' ? currentStage : Math.min(5, currentStage + 1);
  const days = rating === 'again' ? 0 : rating === 'hard' ? 1 : INTERVAL_DAYS[nextStage];
  const nextReviewAt = new Date(now);
  nextReviewAt.setUTCDate(nextReviewAt.getUTCDate() + days);
  return { stage: nextStage, nextReviewAt };
}
