import type { RuleContext, ScenarioFinding, ScenarioKey } from "./types";
import { largeAmount } from "./large-amount";
import { patternOfFunds } from "./pattern-of-funds";
import { roundDollar } from "./round-dollar";
import { wireStructuring } from "./wire-structuring";

export * from "./types";

export const SCENARIO_ORDER: ScenarioKey[] = ["wire_structuring", "pattern_of_funds", "round_dollar", "large_amount"];

/** Runs the four deterministic scenario rules (no LLM). */
export function runRules(ctx: RuleContext): ScenarioFinding[] {
  return [wireStructuring(ctx), patternOfFunds(ctx), roundDollar(ctx), largeAmount(ctx)].filter(
    (f): f is ScenarioFinding => f !== null,
  );
}

export { largeAmount, patternOfFunds, roundDollar, wireStructuring };
