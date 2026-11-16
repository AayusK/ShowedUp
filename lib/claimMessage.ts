/**
 * The exact text an attendee's wallet signs to claim. Shared by the claim page (which asks
 * the wallet to sign it) and the server (which rebuilds it and checks the signature).
 */
export function claimMessage(eventId: string, code: string, wallet: string): string {
  return `ShowedUp claim:${eventId}:${code}:${wallet}`;
}
