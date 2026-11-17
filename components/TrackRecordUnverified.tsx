import { Icon } from "./Icon";
import { explorerLink } from "@/lib/solana";
import type { UnverifiedBadge } from "@/lib/profileClient";
import { unverifiedDay, unverifiedReason } from "@/lib/trackRecord";

/**
 * Tokens that copy our format but aren't counted. Shown muted and apart from the record, with
 * checked facts only (never the token's own free-text name). Renders nothing when there are none.
 */
export function TrackRecordUnverified({ badges, total }: { badges: UnverifiedBadge[]; total: number }) {
  if (badges.length === 0) return null;
  const more = total - badges.length;
  return (
    <section className="tr-unverified">
      <div className="tr-unverified-head">
        <h2>Unverified issuer · not counted</h2>
        <p>These tokens look like ShowedUp badges, but they come from a wallet that isn’t a registered club, or from a club that hasn’t been verified yet. They’re listed so you can see them, and they never add to the track record above.</p>
      </div>
      <div className="panel tr-unverified-list">
        {badges.map((b) => (
          <div className="event-row" key={b.mint}>
            <div className="event-info">
              <h3>{b.reason === "club_not_verified" ? `${b.role} · waiting on club verification` : (b.role === "Attendee" ? "Claims attendance" : `Claims ${b.role}`)}</h3>
              <p>{unverifiedDay(b.date)} · {unverifiedReason(b)}</p>
            </div>
            <a className="icon-link" href={explorerLink(b.mint)} target="_blank" rel="noreferrer" aria-label="View this unverified token on Solana Explorer"><Icon name="external" size={17}/></a>
          </div>
        ))}
      </div>
      {more > 0 && <p className="tr-note">And {more} more unverified {more === 1 ? "token" : "tokens"} not shown.</p>}
    </section>
  );
}
