export interface TimeRange {
  start: Date;
  end: Date;
}

export function hasOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function findOverlaps(candidate: TimeRange, existing: TimeRange[]): TimeRange[] {
  return existing.filter((range) => hasOverlap(candidate, range));
}
