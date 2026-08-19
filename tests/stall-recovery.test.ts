import test from "node:test";
import assert from "node:assert/strict";
import {
	STALL_RECOVERY_PROMPT,
	createStallRecoveryTurnOutcome,
	decideStallRecovery,
	isNonContinuableProviderError,
} from "../extensions/continue/src/stall-recovery.ts";

function outcome(overrides = {}) {
	return { ...createStallRecoveryTurnOutcome(), ...overrides };
}

test("STALL_RECOVERY_PROMPT resumes the same work without restarting it", () => {
	assert.match(STALL_RECOVERY_PROMPT, /stopped before the work was finished/);
	assert.match(STALL_RECOVERY_PROMPT, /Continue the same task/);
	assert.match(STALL_RECOVERY_PROMPT, /do not restart work that already completed/);
});

test("decideStallRecovery resumes turns that stopped mid-work", () => {
	assert.deepEqual(decideStallRecovery(outcome({ assistantStopReason: "error" })), {
		action: "resume",
		reason: "the turn ended on a provider error",
	});
	assert.equal(decideStallRecovery(outcome({ assistantStopReason: "length" })).action, "resume");
	assert.equal(decideStallRecovery(outcome({ assistantStopReason: "toolUse" })).action, "resume");
	// No assistant response at all, and an assistant response with no text, are both interrupted turns.
	assert.equal(decideStallRecovery(outcome()).action, "resume");
	assert.equal(decideStallRecovery(outcome({ assistantStopReason: "stop" })).action, "resume");
});

test("decideStallRecovery leaves finished and cancelled turns alone", () => {
	assert.deepEqual(decideStallRecovery(outcome({ assistantStopReason: "stop", deliveredAnswer: true })), {
		action: "settled",
		reason: "the assistant finished its answer",
	});
	assert.deepEqual(decideStallRecovery(outcome({ assistantStopReason: "aborted" })), {
		action: "settled",
		reason: "the turn was cancelled",
	});
	assert.equal(decideStallRecovery(outcome({ assistantStopReason: "aborted", deliveredAnswer: true })).action, "settled");
});

test("decideStallRecovery stops on failures a resume cannot fix", () => {
	const nonContinuable = [
		"401 Unauthorized",
		"Authentication failed for \"openai-codex\". Run '/login openai-codex'",
		"Invalid api key provided",
		"You exceeded your current quota, please check your plan and billing details",
		"429 Too Many Requests",
		"Rate limit reached for this model",
		"Model gpt-test is not available for this account",
	];

	for (const errorMessage of nonContinuable) {
		assert.equal(isNonContinuableProviderError(errorMessage), true, errorMessage);
		assert.equal(
			decideStallRecovery(outcome({ assistantStopReason: "error", assistantErrorMessage: errorMessage })).action,
			"stop",
			errorMessage,
		);
	}
});

test("decideStallRecovery treats unexplained provider failures as resumable", () => {
	const continuable = [
		undefined,
		"socket hang up",
		"terminated",
		"stream disconnected before completion",
		"500 Internal Server Error",
		// Capacity failures are transient: Pi already retried them, and a later attempt can work.
		"Overloaded",
	];

	for (const errorMessage of continuable) {
		assert.equal(isNonContinuableProviderError(errorMessage), false, String(errorMessage));
		assert.equal(
			decideStallRecovery(outcome({ assistantStopReason: "error", assistantErrorMessage: errorMessage })).action,
			"resume",
			String(errorMessage),
		);
	}
});
