import type { RouteSegment, RouteStop } from '../types';

const MINUTES_PER_DAY = 24 * 60;

function parseClock(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error(`Invalid time value: ${clock}`);
  }

  return hours * 60 + minutes;
}

export function buildStopTimeline(routeStops: RouteStop[]): { arrive: number; depart: number }[] {
  const timeline: { arrive: number; depart: number }[] = [];
  let dayOffset = 0;
  let previousMinute = 0;

  routeStops.forEach((stop, index) => {
    const arriveBase = stop.arriveTime === '----' ? previousMinute : parseClock(stop.arriveTime);
    const departBase = stop.departTime === '----' ? arriveBase : parseClock(stop.departTime);

    if (index === 0) {
      const depart = departBase;
      timeline.push({ arrive: arriveBase, depart });
      previousMinute = depart;
      return;
    }

    let arrive = arriveBase + dayOffset * MINUTES_PER_DAY;
    while (arrive < previousMinute) {
      dayOffset += 1;
      arrive = arriveBase + dayOffset * MINUTES_PER_DAY;
    }

    let depart = departBase + dayOffset * MINUTES_PER_DAY;
    while (depart < arrive) {
      depart += MINUTES_PER_DAY;
    }

    timeline.push({ arrive, depart });
    previousMinute = depart;
  });

  return timeline;
}

export function buildRouteSegment(routeStops: RouteStop[], fromIndex: number, toIndex: number): RouteSegment {
  const timeline = buildStopTimeline(routeStops);
  const fromStop = routeStops[fromIndex];
  const toStop = routeStops[toIndex];
  const departureMinutes = timeline[fromIndex].depart;
  const arrivalMinutes = timeline[toIndex].arrive;

  return {
    fromStop,
    toStop,
    fromIndex,
    toIndex,
    durationMinutes: arrivalMinutes - departureMinutes,
    departureTime: fromStop.departTime,
    arrivalTime: toStop.arriveTime,
  };
}
