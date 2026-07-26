export interface TaskTick {
  /** When the tick was scheduled for, epoch ms. */
  at: number;
  /** 1-based run counter since server start. */
  sequence: number;
}

export interface TaskStatus {
  /** Most recent first. */
  ticks: TaskTick[];
  total: number;
  /** Epoch ms of the next scheduled run, or null when unscheduled on this node. */
  nextRun: number | null;
}
