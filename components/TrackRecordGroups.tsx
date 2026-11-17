import type { CSSProperties } from "react";
import { Icon } from "./Icon";
import { explorerLink } from "@/lib/solana";
import type { ProfileEvent } from "@/lib/profileClient";
import { badgeDetail, groupTrackRecord, termSummary } from "@/lib/trackRecord";

/** The verified record: one block per club, one panel per term, one row per badge. */
export function TrackRecordGroups({ events }: { events: ProfileEvent[] }) {
  const groups = groupTrackRecord(events);
  let row = 0;
  return (
    <div className="tr-record">
      {groups.map((g) => (
        <section className="tr-club" key={g.club.id}>
          <div className="tr-club-head">
            <h3>{g.club.name}</h3>
            <a className="pill-link tr-verified" href={explorerLink(g.club.issuer)} target="_blank" rel="noreferrer" aria-label={`Verified issuer: view ${g.club.name}’s wallet on Solana Explorer`}>
              <Icon name="shield" size={14}/> Verified issuer <Icon name="external" size={13}/>
            </a>
          </div>
          {g.terms.map((t) => (
            <div className="panel history tr-term" key={t.label}>
              <p className="tr-summary">{termSummary(g.club.name, t)}</p>
              {t.events.map((e) => {
                const detail = badgeDetail(e);
                return (
                  <div className="event-row" key={e.mint} style={{"--row-i": row++} as CSSProperties}>
                    <span className="history-check"><Icon name="check" size={17}/></span>
                    <div className="event-info"><h3>{e.name}</h3>{detail && <p>{detail}</p>}</div>
                    {e.kind === "contribution"
                      ? <span className="quiet-pill tr-role">{e.role}</span>
                      : <span className="quiet-pill">Attendance collected</span>}
                    <a className="icon-link" href={explorerLink(e.mint)} target="_blank" rel="noreferrer" aria-label={`View ${e.name} token on Solana Explorer`}><Icon name="external" size={17}/></a>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
