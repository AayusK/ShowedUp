// Client-side helpers for the shared organizer password.
// It's kept in sessionStorage, so it lasts until the browser tab is closed.

const PASSWORD_KEY = "showedup-organizer-password";

export function readPassword(): string | null {
  try { return sessionStorage.getItem(PASSWORD_KEY); } catch { return null; }
}

export function savePassword(pw: string | null) {
  try {
    if (pw) sessionStorage.setItem(PASSWORD_KEY, pw);
    else sessionStorage.removeItem(PASSWORD_KEY);
  } catch {}
}

export async function checkPassword(pw: string): Promise<boolean> {
  const res = await fetch("/api/organizer/verify", { method: "POST", headers: { "x-organizer-password": pw } });
  return res.ok;
}
