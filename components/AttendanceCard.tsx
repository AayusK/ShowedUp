import { Icon } from "./Icon";
import { getTier } from "@/lib/tiers";

export function AttendanceCard({ small = false, count = 5 }: { small?: boolean; count?: number }) {
  return (
    <div className={`attendance-card ${small ? "small" : ""}`}>
      <div className="card-top">
        <span className="brand mini"><span className="brand-mark">↗</span> ShowedUp</span>
        <Icon name="spark" />
      </div>
      <div className="card-middle">
        <div className="card-orbit"><Icon name="check" size={40} /></div>
        <span className="card-eyebrow">A LITTLE COMMITMENT. A LOT OF POSSIBILITY.</span>
        <h3>You belong here.</h3>
        <p>UBC Builders Club</p>
      </div>
      <div className="card-bottom">
        <span>
          <small>MEMBERSHIP</small>
          {getTier(count)?.name ?? "Getting started"}
        </span>
        <span className="card-number">
          {String(count).padStart(2, "0")}
          <span> / events</span>
        </span>
      </div>
    </div>
  );
}
