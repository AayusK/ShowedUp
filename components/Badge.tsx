import type { ReactNode } from "react";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="badge">
      <span className="dot" />
      {children}
    </span>
  );
}
