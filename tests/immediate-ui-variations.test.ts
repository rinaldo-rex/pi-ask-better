import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	DEFAULT_ASK_CONFIG,
	toAskConfigFileV6,
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
import { renderResultText } from "../src/result.ts";
import { createInitialState } from "../src/state/create.ts";
import {
	canPauseAsk,
	createPauseResult,
	resumePausedState,
} from "../src/state/pause.ts";
import { summarizeResult } from "../src/state/result.ts";
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
		note: "Mock up the trade-off",
		optionNotes: { a: "current unselected note" },
	};
	state.answers.deferred = {
		selected: [{ value: "a", label: "Alpha", index: 1 }],
		uiVariationsRequested: true,
		customSelected: true,
		customText: "private deferred choice",
		note: "deferred note",
	};
	state.answers.next = { selected: [], note: "next note" };
	return state;
}

function snapshot(state = sampleState(), id = "pause-1"): PausedAsk {
	return {
		version: 1,
		id,
		state,
		allowFreeform: false,
		request: "uiVariations",
	};
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

test("immediate pause is not completion and only sends the active mockup request without private choices", () => {
	const state = sampleState();
	const original = structuredClone(state);
	const result = createPauseResult(state, "opaque-id", "uiVariations");
	assert.deepEqual(state, original);
	assert.equal(result.mode, "pause");
	assert.equal(result.cancelled, false);
	assert.deepEqual(result.pause, {
		id: "opaque-id",
		questionId: "current",
		request: "uiVariations",
	});
	assert.deepEqual(
		result.uiVariations?.questions.map((item) => item.id),
		["current"]
	);
	assert.equal(result.laymanExplanation, undefined);
	assert.equal(result.answers.current, undefined);
	assert.equal(result.answers.deferred, undefined);
	assert.deepEqual(result.answers.done?.values, ["a", "my answer"]);
	assert.equal(
		result.uiVariations?.questions[0].optionNotes?.a,
		"current unselected note"
	);
	assert.equal(result.uiVariations?.questions[0].options[0].recommended, true);
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
	assert(text.includes("generating the UI variation mockups"));
	assert(!text.includes("private current choice"));
	assert(!text.includes("private deferred choice"));
	assert(!text.includes("deferred alpha description"));
	assert(
		renderResultText(result).startsWith(
			"Paused for immediate UI variation mockups"
		)
	);
});

test("an existing layman pause keeps its explanation request; deferred h flags stay deferred", () => {
	const state = sampleState();
	const layman = createPauseResult(state, "layman-id");
	assert.equal(layman.pause?.request, "layman");
	assert.deepEqual(
		layman.laymanExplanation?.questions.map((item) => item.id),
		["current"]
	);
	assert.equal(layman.uiVariations, undefined);
	const merged = structuredClone(state);
	merged.answers.current.uiVariationsRequested = true;
	const uiPause = createPauseResult(merged, "ui-id", "uiVariations");
	assert.equal(uiPause.laymanExplanation, undefined);
	assert.deepEqual(
		uiPause.uiVariations?.questions.map((item) => item.id),
		["current"]
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
		assert.throws(() => createPauseResult(value, "id", "uiVariations"));
	}
});

test("uiVariations resume restores drafts and clears only the served h flag, keeping deferred l flags", () => {
	const state = sampleState();
	state.questions[1].requestedType = "single";
	state.questions[1].presentedType = "multi";
	state.answers.current.uiVariationsRequested = true;
	state.answers.current.laymanRequested = true;
	const original = structuredClone(state);
	const restored = resumePausedState(state, [], {
		request: "uiVariations",
	});
	assert.deepEqual(state, original);
	assert.equal(restored.activeTabIndex, 1);
	assert.equal(restored.activeOptionIndex, 1);
	assert.deepEqual(restored.answers.done, state.answers.done);
	assert.deepEqual(restored.answers.deferred, state.answers.deferred);
	assert.deepEqual(restored.answers.next, state.answers.next);
	assert.equal(restored.answers.current.customText, "private current choice");
	assert.equal(restored.answers.current.uiVariationsRequested, undefined);
	assert.equal(restored.answers.current.laymanRequested, true);
	assert.deepEqual(restored.questions, state.questions);
});

test("legacy layman resume still clears the l flag for old checkpoints", () => {
	const state = sampleState();
	state.answers.current.laymanRequested = true;
	const restoredDefault = resumePausedState(state);
	assert.equal(restoredDefault.answers.current.laymanRequested, undefined);
	const restoredLayman = resumePausedState(state, [], { request: "layman" });
	assert.equal(restoredLayman.answers.current.laymanRequested, undefined);
	assert.equal(state.answers.current.laymanRequested, true);
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
	const restored = resumePausedState(
		state,
		[current, revision(state, "next")],
		{ request: "uiVariations" }
	);
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
		assert.throws(() =>
			resumePausedState(state, changes, { request: "uiVariations" })
		);
		assert.deepEqual(state, original);
	}
});

test("versioned snapshots round-trip with the pause request kind and stay defensive", () => {
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
	assert.equal(paused.request, "uiVariations");
	assert.equal(isValidPausedAsk(paused), true);
	assert.equal(
		isValidPausedAsk({ ...snapshot(), request: "nonsense" as never }),
		false
	);
	assert.equal(
		isValidPausedAsk({
			version: 1,
			id: "legacy",
			state: sampleState(),
			allowFreeform: false,
		}),
		true
	);
	appendPausedAsk(pi as never, snapshot(sampleState(), "pause-2"));
	resolvePausedAsk(pi as never, "pause-1");
	assert.equal(findPausedAsk(ctx as never, "pause-1"), undefined);
	assert.equal(findPausedAsk(ctx as never)?.id, "pause-2");
	resolvePausedAsk(pi as never, "pause-2");
	assert.equal(findPausedAsk(ctx as never), undefined);
});

test("Shift+H is additive, configurable, disableable, conflict-safe, and ordinary editor text", () => {
	const state = sampleState();
	assert.equal(
		getInputCommand(state, DEFAULT_ASK_CONFIG, "H").kind,
		"requestImmediateUiVariations"
	);
	for (const kind of ["input", "note"] as const) {
		assert.equal(
			getInputCommand(
				{ ...state, view: { kind, questionId: "current" } },
				DEFAULT_ASK_CONFIG,
				"H"
			).kind,
			"delegateToEditor"
		);
	}
	const file = structuredClone(toAskConfigFileV6(DEFAULT_ASK_CONFIG));
	assert(file.keymaps?.main);
	file.keymaps.main.requestImmediateUiVariations = undefined;
	let migrated = migrateAskConfig(file);
	assert.equal(migrated.notice, undefined);
	assert.deepEqual(migrated.config.keymaps.main.requestImmediateUiVariations, [
		"shift+h",
	]);
	assert.equal(file.keymaps.main.requestImmediateUiVariations, undefined);
	file.keymaps.main.nextTab = ["shift+h"];
	migrated = migrateAskConfig(file);
	assert.equal(migrated.notice, undefined);
	assert.deepEqual(migrated.config.keymaps.main.nextTab, ["shift+h"]);
	assert.deepEqual(
		migrated.config.keymaps.main.requestImmediateUiVariations,
		[]
	);
	file.keymaps.main.nextTab = ["tab"];
	file.keymaps.main.requestImmediateUiVariations = ["ctrl+h"];
	migrated = migrateAskConfig(file);
	assert.equal(
		getInputCommand(state, migrated.config, "\u0008").kind,
		"requestImmediateUiVariations"
	);
	assert.equal(getInputCommand(state, migrated.config, "H").kind, "ignore");
	file.keymaps.main.requestImmediateUiVariations = [];
	assert.deepEqual(
		migrateAskConfig(file).config.keymaps.main.requestImmediateUiVariations,
		[]
	);
	assert(
		renderFooterKeymaps(DEFAULT_ASK_CONFIG, "default").includes(
			"shift+h mockups now"
		)
	);
	assert(
		!renderFooterKeymaps(DEFAULT_ASK_CONFIG, "submit").includes("mockups now")
	);
});

test("legacy flat keymaps keep their existing Shift+H binding during migration", () => {
	for (const schemaVersion of [1, 2, 3]) {
		const migrated = migrateAskConfig({
			schemaVersion,
			keymaps: { dismiss: "shift+h" },
		});
		assert.equal(migrated.notice, undefined);
		assert.deepEqual(migrated.config.keymaps.global.dismiss, ["shift+h"]);
		assert.deepEqual(
			migrated.config.keymaps.main.requestImmediateUiVariations,
			[]
		);
		assert.deepEqual(migrated.config.keymaps.main.requestUiVariations, ["h"]);
	}
});

test("frozen summary distinguishes saved answers, current/deferred requests, and notes at narrow widths", () => {
	const paused = snapshot();
	const lines = pausedWidgetLines(paused);
	assert(lines[0].includes("paused for ui variation mockups"));
	assert(lines[1].includes("saved: Alpha, my answer"));
	assert(lines[1].includes("3 saved note(s)"));
	assert(lines[2].includes("generating mockups now"));
	assert(lines[3].includes("ui variations deferred"));
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
		resumePausedState(state, [], { request: "uiVariations" }).answers.text
			.customText,
		"my freeform draft"
	);
});
