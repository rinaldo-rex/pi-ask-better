import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { successfulResponse } from "../src/ask-tool-helpers.ts";
import {
	DEFAULT_ASK_CONFIG,
	normalizeAskConfig,
	toAskConfigFileV6,
} from "../src/config/defaults.ts";
import { migrateAskConfig } from "../src/config/migrate.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import { UI_VARIATIONS_REQUEST_NOTICE } from "../src/constants/text.ts";
import { renderResultText } from "../src/result.ts";
import { isAnswerAnswered } from "../src/state/answers.ts";
import { createInitialState } from "../src/state/create.ts";
import { syncStateToSelection } from "../src/state/editor.ts";
import { cycleCurrentQuestionType } from "../src/state/question-type.ts";
import { summarizeResult, toAskResult } from "../src/state/result.ts";
import {
	applyNumberShortcut,
	confirmCurrentSelection,
	enterInputMode,
	enterOptionNoteMode,
	enterQuestionNoteMode,
	moveOption,
	moveTab,
	reduceAskState,
	saveNote,
	toggleCurrentOption,
	toggleLaymanRequest,
	toggleUiVariationsRequest,
} from "../src/state/transitions.ts";
import type { AskParams, AskResult, AskState } from "../src/types.ts";
import { maybeAutoSubmitState } from "../src/ui/auto-submit.ts";
import { runAskFlow } from "../src/ui/controller.ts";
import { hasDirtyFlowState } from "../src/ui/dismiss-guard.ts";
import { getInputCommand } from "../src/ui/input.ts";
import { renderAskScreen } from "../src/ui/render.ts";
import { buildReviewScreenModel } from "../src/ui/view-models/review.ts";

const params: AskParams = {
	questions: [
		{
			id: "architecture",
			label: "Design",
			prompt: "Which architecture?",
			type: "multi",
			options: [
				{
					value: "monolith",
					label: "Monolith",
					description: "One deployable application",
					recommended: true,
				},
				{
					value: "services",
					label: "Services",
					description: "Separate deployable applications",
				},
			],
		},
		{
			id: "tone",
			label: "Tone",
			prompt: "Which writing tone?",
			options: [{ value: "friendly", label: "Friendly" }],
		},
		{
			id: "storage",
			label: "Storage",
			prompt: "Which storage?",
			type: "preview",
			options: [
				{ value: "sql", label: "SQL", preview: "Tables and relations" },
				{ value: "files", label: "Files", preview: "Separate documents" },
			],
		},
	],
};

function initialState(): AskState {
	return createInitialState(params);
}

function mixedState(): AskState {
	let state = toggleUiVariationsRequest(initialState());
	state = moveTab(state, 1);
	state = applyNumberShortcut(state, 1);
	return toggleUiVariationsRequest(state);
}

const ansiTheme = {
	fg(color: string, text: string) {
		const codes: Record<string, number> = {
			dim: 2,
			warning: 33,
			success: 32,
			accent: 36,
			text: 37,
			muted: 90,
		};
		return `\x1b[${codes[color] ?? 37}m${text}\x1b[0m`;
	},
	bg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return text;
	},
};

function render(state: AskState, width: number): string[] {
	return renderAskScreen({
		state,
		width,
		config: DEFAULT_ASK_CONFIG,
		theme: ansiTheme as never,
		editor: { getText: () => "", render: () => [] } as never,
	});
}

test("ui variation flag is per-question, reversible, dirty, and not an answer", () => {
	const original = applyNumberShortcut(initialState(), 1);
	const flagged = reduceAskState(original, {
		type: "TOGGLE_UI_VARIATIONS_REQUEST",
	});
	assert.equal(original.answers.architecture.uiVariationsRequested, undefined);
	assert.equal(flagged.answers.architecture.uiVariationsRequested, true);
	assert.deepEqual(
		flagged.answers.architecture.selected,
		original.answers.architecture.selected
	);
	assert.equal(isAnswerAnswered(flagged.answers.architecture), false);
	assert.equal(
		hasDirtyFlowState(toggleUiVariationsRequest(initialState())),
		true
	);
	assert.deepEqual(
		toggleUiVariationsRequest(flagged).answers.architecture.selected,
		original.answers.architecture.selected
	);
	assert.equal(
		toggleUiVariationsRequest(toggleUiVariationsRequest(initialState())).answers
			.architecture,
		undefined
	);
	assert.equal(
		toggleUiVariationsRequest(moveTab(flagged, 1)).answers.architecture
			.uiVariationsRequested,
		true
	);
	const completed = { ...flagged, completed: true };
	assert.equal(toggleUiVariationsRequest(completed), completed);
});

test("flagged choices lock selection, custom input, movement, and type changes but Enter continues", () => {
	for (const activeTabIndex of [0, 1, 2]) {
		const flagged = toggleUiVariationsRequest({
			...initialState(),
			activeTabIndex,
		});
		const id = flagged.questions[activeTabIndex].id;
		assert.equal(applyNumberShortcut(flagged, 1), flagged);
		assert.equal(
			applyNumberShortcut(
				flagged,
				flagged.questions[activeTabIndex].options.length + 1
			),
			flagged
		);
		assert.equal(toggleCurrentOption(flagged), flagged);
		assert.equal(moveOption(flagged, 1), flagged);
		assert.equal(enterInputMode(flagged, id), flagged);
		assert.equal(cycleCurrentQuestionType(flagged).state, flagged);
		assert.equal(
			confirmCurrentSelection(flagged).activeTabIndex,
			activeTabIndex + 1
		);
	}
	const flaggedCustom = toggleUiVariationsRequest({
		...initialState(),
		activeOptionIndex: 2,
	});
	assert.equal(syncStateToSelection(flaggedCustom).view.kind, "navigate");
	assert.equal(
		toggleUiVariationsRequest(
			moveTab({ ...initialState(), activeTabIndex: 2 }, 1)
		).answers.storage,
		undefined
	);
});

test("l and h flags coexist and each can be removed without unlocking the other", () => {
	const state = toggleLaymanRequest(toggleUiVariationsRequest(initialState()));
	const result = toAskResult(state);
	assert.equal(result.laymanExplanation?.questions[0].id, "architecture");
	assert.equal(result.uiVariations?.questions[0].id, "architecture");
	assert.equal(result.answers.architecture, undefined);
	assert.deepEqual(result.continuation?.affectedQuestionIds, ["architecture"]);
	const text = render(state, 140).map(stripTerminalSequences).join("\n");
	assert(text.includes("Layman explanation requested"));
	assert(text.includes("UI variation mockups requested"));
	const review = render(
		{
			...state,
			activeTabIndex: state.questions.length,
			view: { kind: "submit" },
		},
		140
	)
		.map(stripTerminalSequences)
		.join("\n");
	assert(review.includes("Layman explanation requested"));
	assert(review.includes("UI variation mockups requested"));
	const onlyH = toggleLaymanRequest(state);
	assert.equal(applyNumberShortcut(onlyH, 1), onlyH);
	const onlyL = toggleUiVariationsRequest(state);
	assert.equal(applyNumberShortcut(onlyL, 1), onlyL);
	assert.equal(
		isAnswerAnswered(
			applyNumberShortcut(toggleUiVariationsRequest(onlyH), 1).answers
				.architecture
		),
		true
	);
});

test("v5 configs migrate to v6 in memory without taking an existing h shortcut", () => {
	const file = structuredClone(toAskConfigFileV6(DEFAULT_ASK_CONFIG));
	assert(file.keymaps?.main);
	file.keymaps.main.requestUiVariations = undefined;
	file.keymaps.main.requestImmediateUiVariations = undefined;
	file.keymaps.main.nextTab = ["h"];
	const legacy = { ...file, schemaVersion: 5 };
	const before = structuredClone(legacy);
	const migrated = migrateAskConfig(legacy);
	assert.equal(migrated.migrated, true);
	assert.equal(migrated.notice, undefined);
	assert.deepEqual(migrated.config.keymaps.main.nextTab, ["h"]);
	assert.deepEqual(migrated.config.keymaps.main.requestUiVariations, []);
	assert.deepEqual(migrated.config.keymaps.main.requestImmediateUiVariations, [
		"shift+h",
	]);
	assert.deepEqual(legacy, before);
	assert.equal(toAskConfigFileV6(migrated.config).schemaVersion, 6);
});

test("notes and custom choices survive privately while flagged", () => {
	let state = {
		...initialState(),
		answers: {
			architecture: {
				selected: [],
				customSelected: true,
				customText: "Private custom choice",
			},
		},
	} as AskState;
	state = saveNote(
		enterQuestionNoteMode(state, "architecture"),
		"Why this design?"
	);
	state = saveNote(
		enterOptionNoteMode(state, "architecture", "services"),
		"Which layout does this option render?"
	);
	state = toggleUiVariationsRequest(state);
	const result = toAskResult(state);
	assert.equal(result.answers.architecture, undefined);
	assert.equal(result.uiVariations?.questions[0].note, "Why this design?");
	assert.equal(
		result.uiVariations?.questions[0].optionNotes?.services,
		"Which layout does this option render?"
	);
	assert.equal(JSON.stringify(result).includes("Private custom choice"), false);
	const edited = saveNote(
		enterQuestionNoteMode(state, "architecture"),
		"Mock up a dashboard header"
	);
	assert.equal(edited.answers.architecture.uiVariationsRequested, true);
	assert.equal(
		toAskResult(edited).uiVariations?.questions[0].note,
		"Mock up a dashboard header"
	);
	assert.equal(
		toggleUiVariationsRequest(state).answers.architecture.customText,
		"Private custom choice"
	);
	assert.equal(result.uiVariations?.questions[0].options[0].recommended, true);
});

test("mixed submission preserves other answers and emits full mockup context and continuation", () => {
	const result = toAskResult(mixedState());
	assert.equal(result.mode, "submit");
	assert.deepEqual(Object.keys(result.answers), ["tone"]);
	assert.deepEqual(result.answers.tone.values, ["friendly"]);
	assert.deepEqual(
		result.uiVariations?.questions.map((question) => question.id),
		["architecture", "storage"]
	);
	assert.equal(
		result.uiVariations?.questions[1].options[0].preview,
		"Tables and relations"
	);
	assert.deepEqual(result.continuation?.affectedQuestionIds, [
		"architecture",
		"storage",
	]);
	assert.deepEqual(result.continuation?.preservedAnswers.tone.values, [
		"friendly",
	]);
	assert.deepEqual(result.continuation?.questionStates, {
		architecture: { status: "needs_clarification" },
		tone: { status: "answered" },
		storage: { status: "needs_clarification" },
	});
	for (const text of [
		summarizeResult(result),
		renderResultText(result),
		successfulResponse(result).content[0].text,
	]) {
		assert(text.includes("Tone: Friendly"));
		assert(text.includes("Which architecture?"));
		assert(text.includes("Separate deployable applications"));
		assert(text.includes("Tables and relations"));
		assert(text.includes("temporary HTML page"));
		assert(text.includes("side-by-side visual mockups"));
		assert(text.includes("default browser"));
		assert(text.includes("re-ask only these questions"));
		assert.equal(text.includes("Design: (no answer)"), false);
	}
	const elaborate = toAskResult({ ...mixedState(), mode: "elaborate" });
	assert(summarizeResult(elaborate).includes("Tone: Friendly"));
	assert(summarizeResult(elaborate).includes("Tone: (no answer)") === false);
});

test("flagged selections never leak into submit or elaborate results, including notes", () => {
	let state = applyNumberShortcut(initialState(), 1);
	state = toggleUiVariationsRequest(state);
	for (const mode of ["submit", "elaborate"] as const) {
		const result = toAskResult({ ...state, mode });
		assert.equal(result.answers.architecture, undefined);
		assert.equal(result.continuation?.preservedAnswers.architecture, undefined);
		assert.equal(result.elaboration?.items.length ?? 0, 0);
	}
	const cancelled = toAskResult({ ...state, cancelled: true });
	assert.equal(cancelled.uiVariations, undefined);
	assert.equal(cancelled.laymanExplanation, undefined);
	assert.equal(cancelled.continuation, undefined);
	assert.equal(summarizeResult(cancelled), "User cancelled the ask flow");
});

test("normal results remain unchanged and unanswered questions remain unanswered", () => {
	assert.equal(toAskResult(initialState()).uiVariations, undefined);
	const result = toAskResult(toggleUiVariationsRequest(initialState()));
	assert.deepEqual(result.continuation?.questionStates.tone, {
		status: "unanswered",
	});
	assert.equal(result.continuation?.preservedAnswers.tone, undefined);
	assert(summarizeResult(result).includes("Tone: (no answer)"));
});

test("auto-submit counts mockup requests as responses but still respects settings, review location, and notes", () => {
	const enabled = {
		...DEFAULT_ASK_CONFIG,
		behaviour: {
			...DEFAULT_ASK_CONFIG.behaviour,
			autoSubmitWhenAnsweredWithoutNotes: true,
		},
	};
	const state = mixedState();
	assert.equal(maybeAutoSubmitState(state, enabled).completed, false);
	const review = moveTab(state, 1);
	assert.equal(maybeAutoSubmitState(review, enabled).completed, true);
	assert.equal(
		maybeAutoSubmitState(review, DEFAULT_ASK_CONFIG).completed,
		false
	);
	const noted = saveNote(
		enterQuestionNoteMode(state, "storage"),
		"Please mock up the dashboard header"
	);
	assert.equal(
		maybeAutoSubmitState(moveTab(noted, 1), enabled).completed,
		false
	);
	const unanswered = moveTab(toggleUiVariationsRequest(initialState()), -1);
	assert.equal(maybeAutoSubmitState(unanswered, enabled).completed, false);
});

test("h uses a customizable keymap and stays ordinary text in both editors", () => {
	const state = initialState();
	assert.deepEqual(getInputCommand(state, DEFAULT_ASK_CONFIG, "h"), {
		kind: "requestUiVariations",
	});
	const config = normalizeAskConfig({
		...DEFAULT_ASK_CONFIG,
		keymaps: {
			...DEFAULT_ASK_CONFIG.keymaps,
			main: {
				...DEFAULT_ASK_CONFIG.keymaps.main,
				requestUiVariations: ["ctrl+h"],
			},
		},
	});
	assert.deepEqual(getInputCommand(state, config, "\u0008"), {
		kind: "requestUiVariations",
	});
	assert.deepEqual(getInputCommand(state, config, "h"), { kind: "ignore" });
	assert.deepEqual(getInputCommand(state, DEFAULT_ASK_CONFIG, "H"), {
		kind: "requestImmediateUiVariations",
	});
	for (const editorState of [
		enterInputMode(state, "architecture"),
		enterQuestionNoteMode(state, "architecture"),
	]) {
		for (const text of ["", "hello"]) {
			assert.deepEqual(
				getInputCommand(editorState, DEFAULT_ASK_CONFIG, "h", text),
				{ kind: "delegateToEditor" }
			);
			assert.deepEqual(
				getInputCommand(editorState, DEFAULT_ASK_CONFIG, "H", text),
				{ kind: "delegateToEditor" }
			);
		}
	}
});

test("older keymaps gain h without rewriting or discarding existing aliases", () => {
	const file = structuredClone(toAskConfigFileV6(DEFAULT_ASK_CONFIG));
	assert(file.keymaps?.main);
	file.keymaps.main.requestUiVariations = undefined;
	file.keymaps.main.confirm = ["ctrl+k"];
	const result = migrateAskConfig(file);
	assert.equal(result.notice, undefined);
	assert.deepEqual(result.config.keymaps.main.requestUiVariations, ["h"]);
	assert.deepEqual(result.config.keymaps.main.confirm, ["ctrl+k"]);
	assert.equal(file.keymaps.main.requestUiVariations, undefined);
	file.keymaps.main.nextTab = ["h"];
	const conflict = migrateAskConfig(file);
	assert.equal(conflict.notice, undefined);
	assert.deepEqual(conflict.config.keymaps.main.nextTab, ["h"]);
	assert.deepEqual(conflict.config.keymaps.main.requestUiVariations, []);
	assert.deepEqual(
		migrateAskConfig(toAskConfigFileV6(conflict.config)).config.keymaps.main
			.requestUiVariations,
		[]
	);
});

test("question and review rendering mark only flagged questions and dim every choice at narrow/wide widths", () => {
	for (const activeTabIndex of [0, 1, 2]) {
		const state = toggleUiVariationsRequest({
			...initialState(),
			activeTabIndex,
		});
		for (const width of [32, 80, 140]) {
			const lines = render(state, width);
			const text = lines.map(stripTerminalSequences).join("\n");
			assert(text.includes("UI variation mockups requested"));
			assert(text.includes("undo mockup request"));
			assert(text.includes("shift+h mockups now"));
			assert.equal(text.includes("question type"), false);
			assert.equal(text.includes("Space toggle"), false);
			assert.equal(
				lines.every((line) => visibleWidth(line) <= width),
				true
			);
			for (const line of lines.filter(
				(value) =>
					stripTerminalSequences(value).includes("1. ") ||
					stripTerminalSequences(value).includes("(recommended)")
			)) {
				assert(line.startsWith("\x1b[2m"));
				assert.equal(line.includes("\x1b[33m"), false);
			}
			const other = render(
				{
					...state,
					activeTabIndex: (activeTabIndex + 1) % state.questions.length,
				},
				width
			)
				.map(stripTerminalSequences)
				.join("\n");
			assert.equal(other.includes(UI_VARIATIONS_REQUEST_NOTICE), false);
		}
	}
	const review = moveTab(mixedState(), 1);
	const model = buildReviewScreenModel(review, 80);
	assert.equal(model.questions[0].uiVariationsRequested, true);
	assert.equal(model.questions[1].answerText, "Friendly");
	assert.equal(model.questions[2].uiVariationsRequested, true);
	assert.equal(
		render(review, 140)
			.map(stripTerminalSequences)
			.join("\n")
			.split(UI_VARIATIONS_REQUEST_NOTICE).length - 1,
		2
	);
});

interface TestComponent {
	dispose(): void;
	handleInput(data: string): void;
	render(width: number): string[];
}

async function startFlow(
	autoSubmit: boolean
): Promise<{ component: TestComponent; resultPromise: Promise<AskResult> }> {
	getAskConfigStore().setConfig({
		...DEFAULT_ASK_CONFIG,
		behaviour: {
			...DEFAULT_ASK_CONFIG.behaviour,
			autoSubmitWhenAnsweredWithoutNotes: autoSubmit,
		},
		notifications: { ...DEFAULT_ASK_CONFIG.notifications, enabled: false },
	});
	let component: TestComponent | undefined;
	const resultPromise = runAskFlow(
		{
			cwd: process.cwd(),
			mode: "tui",
			ui: {
				custom(callback: (...args: unknown[]) => unknown) {
					return new Promise((resolve) => {
						component = callback(
							{
								requestRender() {
									/* Rendering is inspected explicitly in these tests. */
								},
							},
							ansiTheme,
							{},
							resolve
						) as TestComponent;
					});
				},
			},
		} as never,
		params
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert(component);
	return { component, resultPromise };
}

test("controller submits the mixed batch, and h on Review cannot change question state", {
	timeout: 5000,
}, async (t) => {
	const { component, resultPromise } = await startFlow(false);
	t.after(() => {
		component.dispose();
		getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
	});
	component.handleInput("h");
	component.handleInput("1");
	component.handleInput("\r");
	component.handleInput("1");
	component.handleInput("h");
	component.handleInput("\r");
	component.handleInput("h");
	component.handleInput("\r");
	const result = await resultPromise;
	assert.deepEqual(Object.keys(result.answers), ["tone"]);
	assert.deepEqual(
		result.uiVariations?.questions.map((question) => question.id),
		["architecture", "storage"]
	);
});

test("controller finishes auto-submit when navigation reaches Review", {
	timeout: 5000,
}, async (t) => {
	const { component, resultPromise } = await startFlow(true);
	t.after(() => {
		component.dispose();
		getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
	});
	component.handleInput("h");
	component.handleInput("\t");
	component.handleInput("1");
	component.handleInput("h");
	component.handleInput("\t");
	assert.equal((await resultPromise).mode, "submit");
});

test("controller finishes auto-submit when a final numeric selection reaches Review", {
	timeout: 5000,
}, async (t) => {
	const { component, resultPromise } = await startFlow(true);
	t.after(() => {
		component.dispose();
		getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
	});
	component.handleInput("h");
	component.handleInput("\r");
	component.handleInput("1");
	component.handleInput("1");
	const result = await resultPromise;
	assert.deepEqual(result.answers.storage.values, ["sql"]);
	assert.equal(result.uiVariations?.questions.length, 1);
});
