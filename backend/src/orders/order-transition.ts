export type TrackingRole = 'KITCHEN' | 'WAITER';
export type TrackingStatus = 'PENDING' | 'IN_PREPARATION' | 'READY' | 'DELIVERED';

export function expectedPrevious(role: TrackingRole, target: string): TrackingStatus | null {
  if (role === 'KITCHEN' && target === 'IN_PREPARATION') return 'PENDING';
  if (role === 'KITCHEN' && target === 'READY') return 'IN_PREPARATION';
  if (role === 'WAITER' && target === 'DELIVERED') return 'READY';
  return null;
}
