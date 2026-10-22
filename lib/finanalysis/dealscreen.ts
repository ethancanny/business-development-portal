/**
 * Part 4B — deal screen (PURE, no DB / fs / clock).
 *
 * computeDealScreen({ ebitda, ebitdaBasis, assumptions }) per the 4B
 * contract:
 * - Entry-multiple grid 4.0–8.0 step 0.5, exit multiple = entry multiple.
 *   EV = m × EBITDA; debt = leverageMultiple × EBITDA capped at EV × 0.9;
 *   fees = feesPct × EV; equityCheck = EV + fees − debt;
 *   exitEbitda = EBITDA × (1+g)^hold; exitValue = exitEbitda × exit m;
 *   equityOut = exitValue − debt × (1 − paydown);
 *   moic = equityOut / equityCheck; irr = moic^(1/hold) − 1
 *   (irr null when equityOut <= 0 or equityCheck <= 0).
 * - Sensitivity: entry [4,5,6,7,8] × exit [4,5,6,7,8] → irr + moic cells
 *   (flat array of 25 cells; entry economics from the entry multiple,
 *   exit value from the exit multiple).
 * - Output carries assumptionsUsed, the basis label (both `ebitdaBasis`
 *   and its alias `basis`), and the assumption notes verbatim so the UI
 *   can show them as-is.
 */
import type {
  DealScreenAssumptions,
  DealScreenData,
  DealScreenGridRow,
  DealScreenSensitivityCell,
} from "./types";

export const DEFAULT_DEAL_SCREEN_ASSUMPTIONS: DealScreenAssumptions = {
  leverageMultiple: 3.0,
  feesPct: 0.03,
  growthPct: 0.05,
  holdYears: 5,
  debtPaydownPct: 0,
};

export const DEAL_SCREEN_ASSUMPTION_NOTES: string[] = [
  "Debt held constant except stated paydown %; no interim cash flows; fees = % of enterprise value",
];

export interface DealScreenInput {
  ebitda: number | null;
  ebitdaBasis?: string;
  basis?: string;
  assumptions?: Partial<DealScreenAssumptions>;
}

interface EntryEconomics {
  enterpriseValue: number;
  debt: number;
  fees: number;
  equityCheck: number;
  exitEbitda: number;
}

function entryEconomics(
  ebitda: number,
  entryMultiple: number,
  a: DealScreenAssumptions
): EntryEconomics {
  const enterpriseValue = entryMultiple * ebitda;
  const debt = Math.min(a.leverageMultiple * ebitda, enterpriseValue * 0.9);
  const fees = a.feesPct * enterpriseValue;
  const equityCheck = enterpriseValue + fees - debt;
  const exitEbitda = ebitda * Math.pow(1 + a.growthPct, a.holdYears);
  return { enterpriseValue, debt, fees, equityCheck, exitEbitda };
}

function returns(
  equityCheck: number,
  equityOut: number,
  holdYears: number
): { moic: number | null; irr: number | null } {
  if (!(equityCheck > 0)) return { moic: null, irr: null };
  const moic = equityOut / equityCheck;
  const irr =
    equityOut > 0 && holdYears > 0 ? Math.pow(moic, 1 / holdYears) - 1 : null;
  return { moic, irr };
}

export function computeDealScreen(input: DealScreenInput): DealScreenData {
  const assumptionsUsed: DealScreenAssumptions = {
    ...DEFAULT_DEAL_SCREEN_ASSUMPTIONS,
    ...(input.assumptions ?? {}),
  };
  const basis = input.ebitdaBasis ?? input.basis ?? "reported";
  const ebitda =
    input.ebitda !== null && input.ebitda !== undefined && isFinite(input.ebitda)
      ? input.ebitda
      : null;

  const grid: DealScreenGridRow[] = [];
  for (let i = 0; i <= 8; i++) {
    const m = 4.0 + i * 0.5;
    if (ebitda === null) {
      grid.push({
        entryMultiple: m,
        enterpriseValue: null,
        debt: null,
        fees: null,
        equityCheck: null,
        exitEbitda: null,
        exitValue: null,
        equityOut: null,
        moic: null,
        irr: null,
      });
      continue;
    }
    const e = entryEconomics(ebitda, m, assumptionsUsed);
    const exitValue = e.exitEbitda * m; // exit at the entry multiple
    const equityOut = exitValue - e.debt * (1 - assumptionsUsed.debtPaydownPct);
    const { moic, irr } = returns(e.equityCheck, equityOut, assumptionsUsed.holdYears);
    grid.push({
      entryMultiple: m,
      enterpriseValue: e.enterpriseValue,
      debt: e.debt,
      fees: e.fees,
      equityCheck: e.equityCheck,
      exitEbitda: e.exitEbitda,
      exitValue,
      equityOut,
      moic,
      irr,
    });
  }

  const sensitivity: DealScreenSensitivityCell[] = [];
  const sensMultiples = [4, 5, 6, 7, 8];
  for (const entryMultiple of sensMultiples) {
    for (const exitMultiple of sensMultiples) {
      if (ebitda === null) {
        sensitivity.push({ entryMultiple, exitMultiple, irr: null, moic: null });
        continue;
      }
      const e = entryEconomics(ebitda, entryMultiple, assumptionsUsed);
      const exitValue = e.exitEbitda * exitMultiple;
      const equityOut =
        exitValue - e.debt * (1 - assumptionsUsed.debtPaydownPct);
      const { moic, irr } = returns(
        e.equityCheck,
        equityOut,
        assumptionsUsed.holdYears
      );
      sensitivity.push({ entryMultiple, exitMultiple, irr, moic });
    }
  }

  return {
    ebitda,
    ebitdaBasis: basis,
    basis,
    assumptionsUsed,
    assumptionNotes: [...DEAL_SCREEN_ASSUMPTION_NOTES],
    grid,
    sensitivity,
  };
}
