import type { Attendance, Filters, Occurrence } from "../api/types";

type Reader = { all<T>(path: string, signal?: AbortSignal, filters?: Filters): Promise<T[]> };

export async function loadAttendanceSequence(reader: Reader, root: string, eventId: string, from: string, to: string, signal: AbortSignal) {
  const sessions = (await reader.all<Occurrence>(`${root}/occurrences`, signal, {
    eventId, from, to, includeArchived: true,
  })).filter(session => !session.cancelled && Date.parse(session.startsAt) >= Date.parse(from) && Date.parse(session.startsAt) < Date.parse(to));
  const receipts: Attendance[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, sessions.length) }, async () => {
    while (next < sessions.length) {
      signal.throwIfAborted();
      const session = sessions[next++];
      if (!session) return;
      const items = await reader.all<Attendance>(`${root}/attendance`, signal, { occurrenceId: session.id });
      receipts.push(...items.filter(receipt => receipt.active && receipt.occurrenceId === session.id));
    }
  }));
  return { sessions, receipts };
}