import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	DEFAULT_ASK_CONFIG,
	toAskConfigFileV5,
} from "../src/config/defaults.ts";
import { migrateAskConfig } from "../src/config/migrate.ts";
import { renderFooterKeymaps } from "../src/constants/keymaps.ts";
import {
	appendPausedAsk,
	findPausedAsk,
	isValidPausedAsk,
	type PausedAsk,
	resolvePausedAsk,
} from "../src/paused-ask-store.ts";
import { findPendingAskToolCall } from "../src/pending-ask.ts";
import { renderResultText } from "../src/result.ts";
import { createInitialState } from "../src/state/create.ts";
import {
	canPauseAsk,
	createPauseResult,
	resumePausedState,
} from "../src/state/pause.ts";
import { summarizeResult, toAskResult } from "../src/state/result.ts";
import type { AskQuestionInput, AskState } from "../src/types.ts";
import { getInputCommand } from "../src/ui/input.ts";
import {
	pausedWidgetLines,
	showPausedWidget,
} from "../src/ui/paused-widget.ts";

function sampleState(): AskState {
	const state = createInitialState({
		title: "Planning",
		questions: ["done", "current", "deferred", "next"].map((id) => ({
			id,
			label: id,
			prompt: `Choose ${id}`,
			type: "multi",
			options: [
				{
					value: "a",
					label: "Alpha",
					description: `${id} alpha description`,
					recommended: true,
				},
				{ value: "b", label: "Beta", description: `${id} beta description` },
			],
		})),
	});
	state.activeTabIndex = 1;
	state.activeOptionIndex = 1;
	state.answers.done = {
		selected: [{ value: "a", label: "Alpha", index: 1 }],
		customSelected: true,
		customText: "my answer",
		note: "done note",
		optionNotes: { a: "selected note", b: "unselected note" },
	};
	state.answers.current = {
		selected: [{ value: "b", label: "Beta", index: 2 }],
		customSelected: true,
		customText: "private current choice",
		note: "Explain the trade-off",
		optionNotes: { a: "current unselected note" },
	};
	state.answers.deferred = {
		selected: [{ value: "a", label: "Alpha", index: 1 }],
		laymanRequested: true,
		customSelected: true,
		customText: "private deferred choice",
		note: "deferred note",
	};
	state.answers.next = { selected: [], note: "next note" };
	return state;
}

function snapshot(state = sampleState(), id = "pause-1"): PausedAsk {
	return { version: 1, id, state, allowFreeform: false };
}

function revision(state: AskState, id: string): AskQuestionInput {
	const question = state.questions.find((item) => item.id === id);
	assert(question);
	return {
		...question,
		prompt: `Simplified ${id}`,
		options: question.options.map((option) => ({
			...option,
			description: `${option.description}; for example, a shopping list`,
		})),
	};
}

test("immediate pause is not completion and only sends the active request without private choices", () => {
	const state = sampleState();
	const original = structuredClone(state);
	const result = createPauseResult(state, "opaque-id");
	assert.deepEqual(state, original);
	assert.equal(result.mode, "pause");
	assert.equal(result.cancelled, false);
	assert.deepEqual(result.pause, { id: "opaque-id", questionId: "current" });
	assert.deepEqual(
		result.laymanExplanation?.questions.map((item) => item.id),
		["current"]
	);
	assert.equal(result.answers.current, undefined);
	assert.equal(result.answers.deferred, undefined);
	assert.deepEqual(result.answers.done?.values, ["a", "my answer"]);
	assert.equal(
		result.laymanExplanation?.questions[0].optionNotes?.a,
		"current unselected note"
	);
	assert.equal(
		result.laymanExplanation?.questions[0].options[0].recommended,
		true
	);
	assert.equal(result.continuation?.strategy, "resume");
	assert.deepEqual(result.continuation?.affectedQuestionIds, ["current"]);
	assert.equal(
		result.continuation?.questionStates.deferred.status,
		"needs_clarification"
	);
	const text = summarizeResult(result);
	assert(text.includes("not submitted or cancelled"));
	assert(text.includes("resume_ask_user"));
	assert(text.includes("opaque-id"));
	assert(!text.includes("private current choice"));
	assert(!text.includes("private deferred choice"));
	assert(!text.includes("deferred alpha description"));
	assert(
		renderResultText(result).startsWith("Paused for immediate explanation")
	);
});

test("pause refuses Review, editor, cancelled, and completed surfaces", () => {
	const state = sampleState();
	const invalid = [
		{ ...state, activeTabIndex: state.questions.length },
		{ ...state, view: { kind: "input" as const, questionId: "current" } },
		{ ...state, completed: true },
		{ ...state, cancelled: true },
	];
	for (const value of invalid) {
		assert.equal(canPauseAsk(value), false);
		assert.throws(() => createPauseResult(value, "id"));
	}
});

test("resume restores the active question, all private drafts, notes, overrides, and deferred flags", () => {
	const state = sampleState();
	state.questions[1].requestedType = "single";
	state.questions[1].presentedType = "multi";
	state.answers.current.laymanRequested = true;
	const original = structuredClone(state);
	const restored = resumePausedState(state);
	assert.deepEqual(state, original);
	assert.equal(restored.activeTabIndex, 1);
	assert.equal(restored.activeOptionIndex, 1);
	assert.deepEqual(restored.answers.done, state.answers.done);
	assert.deepEqual(restored.answers.deferred, state.answers.deferred);
	assert.deepEqual(restored.answers.next, state.answers.next);
	assert.equal(restored.answers.current.customText, "private current choice");
	assert.equal(restored.answers.current.laymanRequested, undefined);
	assert.deepEqual(restored.questions, state.questions);
	assert.equal(
		toAskResult(restored).laymanExplanation?.questions[0].id,
		"deferred"
	);
});

test("targeted rewording preserves tab labels, live types, selections by value, and notes", () => {
	const state = sampleState();
	state.questions[1].requestedType = "single";
	state.questions[1].presentedType = "multi";
	const current = revision(state, "current");
	current.type = "single";
	current.label = undefined;
	current.options.reverse();
	current.options[0].label = "Clearer Beta";
	const restored = resumePausedState(state, [current, revision(state, "next")]);
	assert.equal(restored.questions[1].label, "current");
	assert.equal(restored.questions[1].type, "multi");
	assert.equal(restored.activeOptionIndex, 0);
	assert.deepEqual(restored.answers.current.selected, [
		{ value: "b", label: "Clearer Beta", index: 1 },
	]);
	assert.deepEqual(
		restored.answers.current.optionNotes,
		state.answers.current.optionNotes
	);
	assert.equal(restored.questions[3].prompt, "Simplified next");
	assert.deepEqual(restored.questions[0], state.questions[0]);
	assert.deepEqual(restored.questions[2], state.questions[2]);
});

test("unsafe, unknown, duplicate, or invalid revisions fail atomically without discarding state", () => {
	const state = sampleState();
	const original = structuredClone(state);
	const removeNoted = revision(state, "current");
	removeNoted.options = removeNoted.options.filter(
		(option) => option.value !== "a"
	);
	const removeSelected = revision(state, "current");
	removeSelected.options = removeSelected.options.filter(
		(option) => option.value !== "b"
	);
	const single = { ...revision(state, "current"), type: "single" as const };
	const invalid = { ...revision(state, "next"), options: [] };
	for (const changes of [
		[revision(state, "done")],
		[removeNoted],
		[removeSelected],
		[single],
		[invalid],
		[{ ...revision(state, "next"), id: "unknown" }],
		[revision(state, "next"), revision(state, "next")],
	]) {
		assert.throws(() => resumePausedState(state, changes));
		assert.deepEqual(state, original);
	}
});

test("versioned snapshots round-trip and lookups are branch-local, tombstone-aware, and defensive", () => {
	const branch: unknown[] = [];
	const pi = {
		appendEntry(customType: string, data: unknown) {
			branch.push({
				type: "custom",
				customType,
				data: JSON.parse(JSON.stringify(data)),
			});
		},
	};
	const ctx = { sessionManager: { getBranch: () => branch } };
	appendPausedAsk(pi as never, snapshot());
	const paused = findPausedAsk(ctx as never, "pause-1");
	assert(paused);
	assert.equal(isValidPausedAsk(paused), true);
	assert.equal(findPausedAsk(ctx as never, "sibling-id"), undefined);
	assert.equal(
		findPausedAsk(
			{ sessionManager: { getBranch: () => [] } } as never,
			"pause-1"
		),
		undefined
	);
	paused.state.answers.done.customText = "mutated caller copy";
	assert.equal(
		findPausedAsk(ctx as never)?.state.answers.done.customText,
		"my answer"
	);
	appendPausedAsk(pi as never, snapshot(sampleState(), "pause-2"));
	resolvePausedAsk(pi as never, "pause-1");
	assert.equal(findPausedAsk(ctx as never, "pause-1"), undefined);
	assert.equal(findPausedAsk(ctx as never)?.id, "pause-2");
	resolvePausedAsk(pi as never, "pause-2");
	assert.equal(findPausedAsk(ctx as never), undefined);
});

test("an intentional pause prevents replay of a tool call even if its result was interrupted", () => {
	const state = sampleState();
	const branch: unknown[] = [
		{
			type: "message",
			message: {
				role: "assistant",
				stopReason: "toolUse",
				content: [
					{
						type: "toolCall",
						id: "interrupted-call",
						name: "ask_user",
						arguments: { questions: state.questions },
					},
				],
			},
		},
	];
	const ctx = { sessionManager: { getBranch: () => branch } };
	assert.equal(
		findPendingAskToolCall(ctx as never)?.toolCallId,
		"interrupted-call"
	);
	const paused = { ...snapshot(state), pendingToolCallId: "interrupted-call" };
	branch.push({ type: "custom", customType: "ask:paused", data: paused });
	assert.equal(findPendingAskToolCall(ctx as never), undefined);
	branch.push({
		type: "custom",
		customType: "ask:pause-resolved",
		data: { version: 1, id: paused.id },
	});
	assert.equal(findPausedAsk(ctx as never), undefined);
	assert.equal(findPendingAskToolCall(ctx as never), undefined);
	paused.state.completed = true;
	assert.equal(
		findPendingAskToolCall(ctx as never)?.toolCallId,
		"interrupted-call"
	);
});

test("malformed saved state is ignored, not opened", () => {
	const corruptions = [
		(value: PausedAsk) => {
			value.state.activeTabIndex = 100;
		},
		(value: PausedAsk) => {
			value.state.questions[0].options = [];
		},
		(value: PausedAsk) => {
			value.state.answers.done.selected[0].value = "forged";
		},
		(value: PausedAsk) => {
			value.state.answers.done.selected[0].label = "forged";
		},
		(value: PausedAsk) => {
			value.state.answers.done.optionNotes = { unknown: "note" };
		},
		(value: PausedAsk) => {
			value.state.completed = true;
		},
	];
	for (const corrupt of corruptions) {
		const value = snapshot();
		corrupt(value);
		assert.equal(isValidPausedAsk(value), false);
		assert.throws(() =>
			appendPausedAsk(
				{
					appendEntry() {
						assert.fail("Invalid state must not be persisted");
					},
				} as never,
				value
			)
		);
		assert.equal(
			findPausedAsk({
				sessionManager: {
					getBranch: () => [
						{ type: "custom", customType: "ask:paused", data: value },
					],
				},
			} as never),
			undefined
		);
	}
	assert.equal(isValidPausedAsk(null), false);
	assert.equal(isValidPausedAsk({ ...snapshot(), version: 999 }), false);
});

test("Shift+L is additive, configurable, disableable, conflict-safe, and ordinary editor text", () => {
	const state = sampleState();
	assert.equal(
		getInputCommand(state, DEFAULT_ASK_CONFIG, "L").kind,
		"requestImmediateLaymanExplanation"
	);
	for (const kind of ["input", "note"] as const) {
		assert.equal(
			getInputCommand(
				{ ...state, view: { kind, questionId: "current" } },
				DEFAULT_ASK_CONFIG,
				"L"
			).kind,
			"delegateToEditor"
		);
	}
	const file = structuredClone(toAskConfigFileV5(DEFAULT_ASK_CONFIG));
	assert(file.keymaps?.main);
	file.keymaps.main.requestImmediateLaymanExplanation = undefined;
	let migrated = migrateAskConfig(file);
	assert.equal(migrated.notice, undefined);
	assert.deepEqual(
		migrated.config.keymaps.main.requestImmediateLaymanExplanation,
		["shift+l"]
	);
	assert.equal(file.keymaps.main.requestImmediateLaymanExplanation, undefined);
	file.keymaps.main.nextTab = ["shift+l"];
	migrated = migrateAskConfig(file);
	assert.equal(migrated.notice, undefined);
	assert.deepEqual(migrated.config.keymaps.main.nextTab, ["shift+l"]);
	assert.deepEqual(
		migrated.config.keymaps.main.requestImmediateLaymanExplanation,
		[]
	);
	file.keymaps.main.nextTab = ["tab"];
	file.keymaps.main.requestImmediateLaymanExplanation = ["ctrl+l"];
	migrated = migrateAskConfig(file);
	assert.equal(
		getInputCommand(state, migrated.config, "\u000c").kind,
		"requestImmediateLaymanExplanation"
	);
	assert.equal(getInputCommand(state, migrated.config, "L").kind, "ignore");
	file.keymaps.main.requestImmediateLaymanExplanation = [];
	assert.deepEqual(
		migrateAskConfig(file).config.keymaps.main
			.requestImmediateLaymanExplanation,
		[]
	);
	assert(
		renderFooterKeymaps(DEFAULT_ASK_CONFIG, "default").includes(
			"shift+l explain now"
		)
	);
	assert(
		!renderFooterKeymaps(DEFAULT_ASK_CONFIG, "submit").includes("explain now")
	);
});

test("legacy flat keymaps keep their existing Shift+L binding during migration", () => {
	for (const schemaVersion of [1, 2, 3]) {
		const migrated = migrateAskConfig({
			schemaVersion,
			keymaps: { dismiss: "shift+l" },
		});
		assert.equal(migrated.notice, undefined);
		assert.deepEqual(migrated.config.keymaps.global.dismiss, ["shift+l"]);
		assert.deepEqual(
			migrated.config.keymaps.main.requestImmediateLaymanExplanation,
			[]
		);
		assert.deepEqual(migrated.config.keymaps.main.requestLaymanExplanation, [
			"l",
		]);
	}
});

test("frozen summary distinguishes saved answers, current/deferred requests, and notes at narrow widths", () => {
	const paused = snapshot();
	const lines = pausedWidgetLines(paused);
	assert(lines[1].includes("saved: Alpha, my answer"));
	assert(lines[1].includes("3 saved note(s)"));
	assert(lines[2].includes("explaining now"));
	assert(lines[3].includes("explanation deferred"));
	assert(!lines.join("\n").includes("private current choice"));
	let factory: any;
	showPausedWidget(
		{
			mode: "tui",
			ui: {
				setWidget(_name: string, value: unknown) {
					factory = value;
				},
			},
		} as never,
		paused
	);
	const widget = factory({}, { fg: (_token: string, text: string) => text });
	for (const width of [20, 60, 120]) {
		assert(
			widget.render(width).every((line: string) => visibleWidth(line) <= width)
		);
	}
});

test("/answer freeform snapshots preserve typed text without becoming a public schema option", () => {
	const state = createInitialState(
		{
			questions: [
				{
					id: "text",
					prompt: "Your thoughts?",
					options: [{ value: "free", label: "Type", freeform: true }],
				},
			],
		},
		{ allowFreeform: true }
	);
	state.answers.text = {
		selected: [],
		customSelected: true,
		customText: "my freeform draft",
	};
	assert.equal(
		isValidPausedAsk({ ...snapshot(state), allowFreeform: true }),
		true
	);
	assert.equal(isValidPausedAsk(snapshot(state)), false);
	assert.equal(
		resumePausedState(state).answers.text.customText,
		"my freeform draft"
	);
});
