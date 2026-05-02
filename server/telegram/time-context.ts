const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function getTimeContextBlock(): string {
  const now = new Date();
  const weekday = WEEKDAYS[now.getUTCDay()];
  const month = MONTHS[now.getUTCMonth()];
  const day = now.getUTCDate();
  const year = now.getUTCFullYear();
  const iso = now.toISOString().slice(0, 10);
  return `--- TIME CONTEXT ---
Today is ${weekday}, ${month} ${day}, ${year} (UTC, ${iso}).
Treat any relative time word in stored facts ("tomorrow", "tonight", "next week", "soon") as relative to the date that fact was originally said, NOT to today. If a stored fact says "the AMA is tomorrow" and was learned 5 days ago, the AMA already happened. If a fact has an explicit event date attached and that date is in the past, the event is over. Never repeat past events as if they are upcoming. If you are not sure whether a dated fact is still current, do not bring it up.`;
}

export function formatLearnedAge(createdAt: Date | string | null | undefined): string {
  if (!createdAt) return "learned an unknown time ago";
  const ts = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const ms = Date.now() - ts.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours <= 0) return "learned moments ago";
    if (hours === 1) return "learned 1 hour ago";
    return `learned ${hours} hours ago`;
  }
  if (days === 1) return "learned 1 day ago";
  return `learned ${days} days ago`;
}

export function formatEventDate(eventDate: string | Date | null | undefined): string {
  if (!eventDate) return "no date attached";
  const iso = typeof eventDate === "string" ? eventDate : eventDate.toISOString().slice(0, 10);
  const dt = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(dt.getTime())) return "no date attached";
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const eventUtc = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  const days = Math.round((eventUtc - todayUtc) / (24 * 60 * 60 * 1000));
  if (days === 0) return `event today (${iso})`;
  if (days === 1) return `event tomorrow (${iso})`;
  if (days === -1) return `event was yesterday (${iso})`;
  if (days > 1) return `event in ${days} days (${iso})`;
  return `event was ${Math.abs(days)} days ago (${iso})`;
}
