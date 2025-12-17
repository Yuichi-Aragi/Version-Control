import { calculateTextStats } from '@/utils/text-stats';
import type { TextStats } from '@/utils/text-stats';

export class StatsHelper {
  static calculate(content: string): TextStats {
    return calculateTextStats(content);
  }
}
