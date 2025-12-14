import { calculateTextStats } from '@/utils/text-stats';
import type { TextStats } from '@/utils/text-stats';

/**
 * Prepares text statistics for version metadata
 */
export class StatsPreparer {
  /**
   * Calculates text statistics from content
   */
  static prepareStats(content: string): TextStats {
    return calculateTextStats(content);
  }
}
