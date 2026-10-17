import { useState, useEffect } from 'react';

export interface AirCountdownResult {
  countdownText: string;
  badgeText: string;
  status: 'aired' | 'airing_today' | 'upcoming';
  isAired: boolean;
  diffMs: number;
  diffDays: number;
  diffHours: number;
  diffMinutes: number;
  diffSeconds: number;
}

/**
 * Calculates countdown according to user specifications:
 * - If more than a day, uses days: "In 3 days", "In 1 day"
 * - If less than a day, uses hours & minutes until aired: "Airs in 5h 25m", "Airs in 42m"
 * - When aired (time passed or torrent available), says "Aired"
 */
export function calculateAirCountdown(
  airTimestamp?: string | Date,
  airDate?: string,
  isAvailable?: boolean,
  isAlreadyAired?: boolean
): AirCountdownResult {
  // If verified torrent download links already exist, it has definitively aired!
  if (isAvailable) {
    return {
      countdownText: 'Aired',
      badgeText: 'Aired',
      status: 'aired',
      isAired: true,
      diffMs: 0,
      diffDays: 0,
      diffHours: 0,
      diffMinutes: 0,
      diffSeconds: 0
    };
  }

  let targetMs = 0;
  if (airTimestamp) {
    targetMs = new Date(airTimestamp).getTime();
  } else if (airDate) {
    // Standard US prime-time broadcast is 8:00 PM Eastern (EDT UTC-4 / EST UTC-5)
    // Use 20:00:00-04:00 which equals 00:00:00 UTC next day
    targetMs = new Date(`${airDate}T20:00:00-04:00`).getTime();
    if (isNaN(targetMs)) {
      targetMs = new Date(`${airDate}T00:00:00Z`).getTime();
    }
  }

  if (!targetMs || isNaN(targetMs)) {
    const defaultLabel = isAlreadyAired ? 'Aired' : (airDate || 'Scheduled');
    return {
      countdownText: defaultLabel,
      badgeText: defaultLabel,
      status: isAlreadyAired ? 'aired' : 'upcoming',
      isAired: Boolean(isAlreadyAired),
      diffMs: 0,
      diffDays: 0,
      diffHours: 0,
      diffMinutes: 0,
      diffSeconds: 0
    };
  }

  const nowMs = Date.now();
  const diffMs = targetMs - nowMs;

  // When broadcast time has arrived or passed
  if (diffMs <= 0 || isAlreadyAired) {
    return {
      countdownText: 'Aired',
      badgeText: 'Aired',
      status: 'aired',
      isAired: true,
      diffMs: 0,
      diffDays: 0,
      diffHours: 0,
      diffMinutes: 0,
      diffSeconds: 0
    };
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor(diffMs / oneDayMs);
  const diffHours = Math.floor((diffMs % oneDayMs) / (60 * 60 * 1000));
  const diffMinutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  const diffSeconds = Math.floor((diffMs % (60 * 1000)) / 1000);

  // If more than a day, use day
  if (diffMs >= oneDayMs) {
    const dayLabel = diffDays === 1 ? 'In 1 day' : `In ${diffDays} days`;
    return {
      countdownText: dayLabel,
      badgeText: dayLabel,
      status: 'upcoming',
      isAired: false,
      diffMs,
      diffDays,
      diffHours,
      diffMinutes,
      diffSeconds
    };
  }

  // If less than a day, use time, minutes till it airs!
  let timeText = '';
  let badgeLabel = '';

  if (diffHours > 0) {
    timeText = `Airs in ${diffHours}h ${diffMinutes}m`;
    badgeLabel = `${diffHours}h ${diffMinutes}m till air`;
  } else {
    const mins = Math.max(1, diffMinutes);
    timeText = `Airs in ${mins}m`;
    badgeLabel = `${mins}m till air`;
  }

  return {
    countdownText: timeText,
    badgeText: badgeLabel,
    status: 'airing_today',
    isAired: false,
    diffMs,
    diffDays: 0,
    diffHours,
    diffMinutes,
    diffSeconds
  };
}

/**
 * React hook that re-evaluates countdown live on a ticking timer
 */
export function useLiveAirCountdown(
  airTimestamp?: string | Date,
  airDate?: string,
  isAvailable?: boolean,
  isAlreadyAired?: boolean
): AirCountdownResult {
  const [countdown, setCountdown] = useState<AirCountdownResult>(() =>
    calculateAirCountdown(airTimestamp, airDate, isAvailable, isAlreadyAired)
  );

  useEffect(() => {
    // Initial evaluation
    const initial = calculateAirCountdown(airTimestamp, airDate, isAvailable, isAlreadyAired);
    setCountdown(initial);

    // If already aired or no future date, no need to tick
    if (initial.isAired || initial.diffMs <= 0) return;

    // Tick faster (every 1 second) if less than 1 hour away, or every 15 seconds if less than a day, or every minute if > 1 day
    const intervalMs = initial.diffMs < 60 * 60 * 1000 
      ? 1000 
      : initial.diffMs < 24 * 60 * 60 * 1000 
      ? 15000 
      : 60000;

    const timer = setInterval(() => {
      const next = calculateAirCountdown(airTimestamp, airDate, isAvailable, isAlreadyAired);
      setCountdown(next);
      if (next.isAired) {
        clearInterval(timer);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [airTimestamp, airDate, isAvailable, isAlreadyAired]);

  return countdown;
}
