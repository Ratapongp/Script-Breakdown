// Pricing constants — single source of truth.
// Stripe amounts are in satang (1 THB = 100 satang).
//
// Credit logic: ceil(pageCount / 50) credits per parse.
//   1–50 pages  = 1 credit
//   51–100      = 2 credits
//   101–150     = 3 credits

export const PAGES_PER_CREDIT = 50;

export function creditsForPages(pageCount: number): number {
  if (pageCount <= 0) return 1;
  return Math.ceil(pageCount / PAGES_PER_CREDIT);
}

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  amount: number;        // total satang
  amountTHB: number;     // baht
  perCreditTHB: number;
  savePct?: number;
  highlight?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "single", name: "Single", credits: 1, amount: 5000, amountTHB: 50, perCreditTHB: 50 },
  { id: "mini", name: "Mini", credits: 5, amount: 22500, amountTHB: 225, perCreditTHB: 45, savePct: 10 },
  { id: "pro", name: "Pro", credits: 10, amount: 40000, amountTHB: 400, perCreditTHB: 40, savePct: 20, highlight: true },
  { id: "studio", name: "Studio", credits: 25, amount: 90000, amountTHB: 900, perCreditTHB: 36, savePct: 28 },
  { id: "enterprise", name: "Enterprise", credits: 50, amount: 150000, amountTHB: 1500, perCreditTHB: 30, savePct: 40 },
];

export function findPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}
