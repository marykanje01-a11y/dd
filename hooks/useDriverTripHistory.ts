import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firestore } from '@/config/firebase';

type Period = 'today' | 'week' | 'month';
export type DriverTrip = { id: string; pickup: string; destination: string; amount: number; createdAt: Date | null; workflowType: 'direct_trip' | 'store_delivery' | 'unknown' };

function asDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstString(...values: any[]) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || 'Address unavailable';
}

function firstNumber(...values: any[]) {
  const value = values.find((item) => typeof item === 'number' || (typeof item === 'string' && item.trim()));
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function useDriverTripHistory(driverId: string | null, period: Period) {
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [loading, setLoading] = useState(Boolean(driverId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!driverId) { setTrips([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const q = query(collection(firestore, 'orders'), where('driverId', '==', driverId));
    return onSnapshot(q, (snapshot) => {
      const next = snapshot.docs.map((item) => {
        const data = item.data() as any;
        return {
          id: item.id,
          pickup: firstString(data.pickupAddress, data.pickup?.address, data.origin, data.pickup),
          destination: firstString(data.destinationAddress, data.destination?.address, data.dropoffAddress, data.dropoff?.address, data.destination),
          amount: String(data.workflowType).toLowerCase() === 'store_delivery'
            ? firstNumber(data.fee, data.driverEarnings, data.earnings, data.amount, data.price)
            : firstNumber(data.total, data.driverEarnings, data.earnings, data.fare, data.totalFare, data.amount, data.price),
          createdAt: asDate(data.completedAt || data.updatedAt || data.createdAt),
          workflowType: data.workflowType === 'direct_trip' || data.workflowType === 'store_delivery' ? data.workflowType : 'unknown',
        };
      }).filter((trip) => {
        const status = (snapshot.docs.find((doc) => doc.id === trip.id)?.data() as any)?.status;
        return ['completed', 'delivered'].includes(String(status).toLowerCase());
      });
      setTrips(next); setLoading(false);
    }, () => { setError('Unable to load trip history.'); setLoading(false); });
  }, [driverId, period]);

  const filteredTrips = useMemo(() => {
    const now = new Date();
    return trips.filter((trip) => {
      if (!trip.createdAt) return false;
      if (period === 'today') return trip.createdAt.toDateString() === now.toDateString();
      const start = new Date(now);
      if (period === 'week') start.setDate(now.getDate() - 7);
      else start.setMonth(now.getMonth() - 1);
      return trip.createdAt >= start;
    });
  }, [trips, period]);

  return { trips: filteredTrips, loading, error, totalEarnings: filteredTrips.reduce((sum, trip) => sum + trip.amount, 0) };
}
export type { Period };
