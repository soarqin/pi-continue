import type { StallRecoveryDecision, StallRecoveryTurnOutcome } from "./types.ts";

/** Resume nudge for a turn that stopped without finishing the work. */
export const STALL_RECOVERY_PROMPT = [
	"The previous turn stopped before the work was finished, and no answer was delivered.",
	"Continue the same task from the current live state.",
	"Re-check the last tool results before repeating an action, and do not restart work that already completed.",
].join("\n");

/**
 * Access failures that stay broken until a human changes something: credentials,
 * permissions, quota and billing, allowance limits, and unavailable models.
 *
 * Transient failures stay resumable. Pi already retries the transient errors it
 * recognizes, and a server or network failure that survived those retries is still
 * worth one more attempt rather than a silent stop.
 */
const NON_CONTINUABLE_ERROR_PATTERNS: readonly RegExp[] = [
	/\b(?:401|403|407)\b/,
	/unauthorized|forbidden|permission denied/i,
	/authenticat|credential|api[ _-]?key|access token|oauth|\/login\b/i,
	/quota|billing|payment|insufficient (?:credits|funds|balance|quota)|subscription|plan limit|usage limit/i,
	/rate.?limit|too many requests|\b429\b/i,
	/model .*(?:not found|not available|unsupported)|unknown model|no model selected/i,
];

/** Stop reasons that end a turn without any need for a nudge. */
const SETTLED_STOP_REASONS = new Set<string>(["aborted"]);

export function isNonContinuableProviderError(errorMessage: string | undefined): boolean {
	if (!errorMessage) return false;
	return NON_CONTINUABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

export function createStallRecoveryTurnOutcome(): StallRecoveryTurnOutcome {
	return { assistantStopReason: undefined, assistantErrorMessage: undefined, deliveredAnswer: false };
}

/**
 * Classify how the finished turn ended.
 *
 * `resume` means the turn stopped mid-work: a provider error Pi could not retry,
 * an output-limit cut, an unfinished tool loop, an empty response, or no assistant
 * response at all. `stop` is reserved for failures a nudge cannot fix.
 */
export function decideStallRecovery(outcome: StallRecoveryTurnOutcome): StallRecoveryDecision {
	const stopReason = outcome.assistantStopReason;
	if (stopReason !== undefined && SETTLED_STOP_REASONS.has(stopReason)) {
		return { action: "settled", reason: "the turn was cancelled" };
	}
	if (isNonContinuableProviderError(outcome.assistantErrorMessage)) {
		return { action: "stop", reason: "the provider reported an error that needs attention before continuing" };
	}
	if (stopReason === "error") return { action: "resume", reason: "the turn ended on a provider error" };
	if (stopReason === "length") return { action: "resume", reason: "the response hit the output token limit" };
	if (stopReason === "toolUse") return { action: "resume", reason: "the tool loop stopped before the assistant answered" };
	if (stopReason === undefined) return { action: "resume", reason: "the turn ended without an assistant response" };
	if (!outcome.deliveredAnswer) return { action: "resume", reason: "the assistant response was empty" };
	return { action: "settled", reason: "the assistant finished its answer" };
}
