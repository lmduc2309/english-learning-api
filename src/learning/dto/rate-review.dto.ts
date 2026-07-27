import { IsIn } from 'class-validator';
import { ReviewRating } from '../leitner';

export class RateReviewDto {
  @IsIn(['again', 'hard', 'easy'])
  rating: ReviewRating;
}
