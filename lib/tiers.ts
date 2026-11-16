export interface Tier {
  name: string;
  min: number;
}

const TIERS: Tier[] = [
  { name: "Showed Up", min: 1 },
  { name: "Regular", min: 3 },
  { name: "Core Member", min: 5 },
];

export function getTier(count: number): Tier | null {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (count >= TIERS[i].min) return TIERS[i];
  }
  return null;
}

export function getNextTier(count: number): Tier | null {
  for (const tier of TIERS) {
    if (count < tier.min) return tier;
  }
  return null;
}
