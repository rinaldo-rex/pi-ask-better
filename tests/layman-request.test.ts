import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { successfulResponse } from "../src/ask-tool-helpers.ts";
import {
	DEFAULT_ASK_CONFIG,
	normalizeAskConfig,
	toAskConfigFileV5,
} from "../src/config/defaults.ts";
import { migrateAskConfig } from "../src/config/migrate.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import { LAYMAN_REQUEST_NOTICE } from "../src/constants/text.ts";
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
	let state = toggleLaymanRequest(initialState());
	state = moveTab(state, 1);
	state = applyNumberShortcut(state, 1);
	return toggleLaymanRequest(state);
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

test("layman flag is per-question, reversible, dirty, and not an answer", () => {
	const original = applyNumberShortcut(initialState(), 1);
	const flagged = reduceAskState(original, { type: "TOGGLE_LAYMAN_REQUEST" });
	assert.equal(original.answers.architecture.laymanRequested, undefined);
	assert.equal(flagged.answers.architecture.laymanRequested, true);
	assert.deepEqual(
		flagged.answers.architecture.selected,
		original.answers.architecture.selected
	);
	assert.equal(isAnswerAnswered(flagged.answers.architecture), false);
	assert.equal(hasDirtyFlowState(toggleLaymanRequest(initialState())), true);
	assert.deepEqual(
		toggleLaymanRequest(flagged).answers.architecture.selected,
		original.answers.architecture.selected
	);
	assert.equal(
		toggleLaymanRequest(toggleLaymanRequest(initialState())).answers
			.architecture,
		undefined
	);
	assert.equal(
		toggleLaymanRequest(moveTab(flagged, 1)).answers.architecture
			.laymanRequested,
		true
	);
	const completed = { ...flagged, completed: true };
	assert.equal(toggleLaymanRequest(completed), completed);
});

test("flagged choices lock selection, custom input, movement, and type changes but Enter continues", () => {
	for (const activeTabIndex of [0, 1, 2]) {
		const flagged = toggleLaymanRequest({ ...initialState(), activeTabIndex });
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
	const flaggedCustom = toggleLaymanRequest({
		...initialState(),
		activeOptionIndex: 2,
	});
	assert.equal(syncStateToSelection(flaggedCustom).view.kind, "navigate");
	assert.equal(
		toggleLaymanRequest(moveTab({ ...initialState(), activeTabIndex: 2 }, 1))
			.answers.storage,
		undefined
	);
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
		"What does deployable mean?"
	);
	state = toggleLaymanRequest(state);
	const result = toAskResult(state);
	assert.equal(result.answers.architecture, undefined);
	assert.equal(result.laymanExplanation?.questions[0].note, "Why this design?");
	assert.equal(
		result.laymanExplanation?.questions[0].optionNotes?.services,
		"What does deployable mean?"
	);
	assert.equal(JSON.stringify(result).includes("Private custom choice"), false);
	const edited = saveNote(
		enterQuestionNoteMode(state, "architecture"),
		"Use a shopping-list example"
	);
	assert.equal(edited.answers.architecture.laymanRequested, true);
	assert.equal(
		toAskResult(edited).laymanExplanation?.questions[0].note,
		"Use a shopping-list example"
	);
	assert.equal(
		toggleLaymanRequest(state).answers.architecture.customText,
		"Private custom choice"
	);
	assert.equal(
		result.laymanExplanation?.questions[0].options[0].recommended,
		true
	);
});

test("mixed submission preserves other answers and emits full explanation context and continuation", () => {
	const result = toAskResult(mixedState());
	assert.equal(result.mode, "submit");
	assert.deepEqual(Object.keys(result.answers), ["tone"]);
	assert.deepEqual(result.answers.tone.values, ["friendly"]);
	assert.deepEqual(
		result.laymanExplanation?.questions.map((question) => question.id),
		["architecture", "storage"]
	);
	assert.equal(
		result.laymanExplanation?.questions[1].options[0].preview,
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
		assert(text.includes("everyday language"));
		assert(text.includes("inline examples"));
		assert(text.includes("re-ask only these questions"));
		assert.equal(text.includes("Design: (no answer)"), false);
	}
	const elaborate = toAskResult({ ...mixedState(), mode: "elaborate" });
	assert(summarizeResult(elaborate).includes("Tone: Friendly"));
	assert(summarizeResult(elaborate).includes("layman explanation"));
});

test("flagged selections never leak into submit or elaborate results, including notes", () => {
	let state = applyNumberShortcut(initialState(), 1);
	state = toggleLaymanRequest(state);
	for (const mode of ["submit", "elaborate"] as const) {
		const result = toAskResult({ ...state, mode });
		assert.equal(result.answers.architecture, undefined);
		assert.equal(result.continuation?.preservedAnswers.architecture, undefined);
		assert.equal(result.elaboration?.items.length ?? 0, 0);
	}
	const cancelled = toAskResult({ ...state, cancelled: true });
	assert.equal(cancelled.laymanExplanation, undefined);
	assert.equal(cancelled.continuation, undefined);
	assert.equal(summarizeResult(cancelled), "User cancelled the ask flow");
});

test("normal results remain unchanged and unanswered questions remain unanswered", () => {
	assert.equal(toAskResult(initialState()).laymanExplanation, undefined);
	const result = toAskResult(toggleLaymanRequest(initialState()));
	assert.deepEqual(result.continuation?.questionStates.tone, {
		status: "unanswered",
	});
	assert.equal(result.continuation?.preservedAnswers.tone, undefined);
	assert(summarizeResult(result).includes("Tone: (no answer)"));
});

test("auto-submit counts requests as responses but still respects settings, review location, and notes", () => {
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
		"Please include a shopping-list example"
	);
	assert.equal(
		maybeAutoSubmitState(moveTab(noted, 1), enabled).completed,
		false
	);
	const unanswered = moveTab(toggleLaymanRequest(initialState()), -1);
	assert.equal(maybeAutoSubmitState(unanswered, enabled).completed, false);
});

test("l uses a customizable keymap and stays ordinary text in both editors", () => {
	const state = initialState();
	assert.deepEqual(getInputCommand(state, DEFAULT_ASK_CONFIG, "l"), {
		kind: "requestLaymanExplanation",
	});
	const config = normalizeAskConfig({
		...DEFAULT_ASK_CONFIG,
		keymaps: {
			...DEFAULT_ASK_CONFIG.keymaps,
			main: {
				...DEFAULT_ASK_CONFIG.keymaps.main,
				requestLaymanExplanation: ["ctrl+l"],
			},
		},
	});
	assert.deepEqual(getInputCommand(state, config, "\u000c"), {
		kind: "requestLaymanExplanation",
	});
	assert.deepEqual(getInputCommand(state, config, "l"), { kind: "ignore" });
	assert.deepEqual(getInputCommand(state, DEFAULT_ASK_CONFIG, "L"), {
		kind: "ignore",
	});
	for (const editorState of [
		enterInputMode(state, "architecture"),
		enterQuestionNoteMode(state, "architecture"),
	]) {
		for (const text of ["", "hello"]) {
			assert.deepEqual(
				getInputCommand(editorState, DEFAULT_ASK_CONFIG, "l", text),
				{ kind: "delegateToEditor" }
			);
		}
	}
});

test("older v5 keymaps gain l without rewriting or discarding existing aliases", () => {
	const file = structuredClone(toAskConfigFileV5(DEFAULT_ASK_CONFIG));
	assert(file.keymaps?.main);
	file.keymaps.main.requestLaymanExplanation = undefined;
	file.keymaps.main.confirm = ["ctrl+k"];
	const result = migrateAskConfig(file);
	assert.equal(result.notice, undefined);
	assert.deepEqual(result.config.keymaps.main.requestLaymanExplanation, ["l"]);
	assert.deepEqual(result.config.keymaps.main.confirm, ["ctrl+k"]);
	assert.equal(file.keymaps.main.requestLaymanExplanation, undefined);
	file.keymaps.main.nextTab = ["l"];
	const conflict = migrateAskConfig(file);
	assert.equal(conflict.notice, undefined);
	assert.deepEqual(conflict.config.keymaps.main.nextTab, ["l"]);
	assert.deepEqual(conflict.config.keymaps.main.requestLaymanExplanation, []);
	assert.deepEqual(
		migrateAskConfig(toAskConfigFileV5(conflict.config)).config.keymaps.main
			.requestLaymanExplanation,
		[]
	);
});

test("question and review rendering mark only flagged questions and dim every choice at narrow/wide widths", () => {
	for (const activeTabIndex of [0, 1, 2]) {
		const state = toggleLaymanRequest({ ...initialState(), activeTabIndex });
		for (const width of [32, 80, 140]) {
			const lines = render(state, width);
			const text = lines.map(stripTerminalSequences).join("\n");
			assert(text.includes("Layman explanation requested"));
			assert(text.includes("undo explanation request"));
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
			assert.equal(other.includes(LAYMAN_REQUEST_NOTICE), false);
		}
	}
	const review = moveTab(mixedState(), 1);
	const model = buildReviewScreenModel(review, 80);
	assert.equal(model.questions[0].laymanRequested, true);
	assert.equal(model.questions[1].answerText, "Friendly");
	assert.equal(model.questions[2].laymanRequested, true);
	assert.equal(
		render(review, 140)
			.map(stripTerminalSequences)
			.join("\n")
			.split(LAYMAN_REQUEST_NOTICE).length - 1,
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

test("controller submits the mixed batch, and l on Review cannot change question state", {
	timeout: 5000,
}, async (t) => {
	const { component, resultPromise } = await startFlow(false);
	t.after(() => {
		component.dispose();
		getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
	});
	component.handleInput("l");
	component.handleInput("1");
	component.handleInput("\r");
	component.handleInput("1");
	component.handleInput("l");
	component.handleInput("\r");
	component.handleInput("l");
	component.handleInput("\r");
	const result = await resultPromise;
	assert.deepEqual(Object.keys(result.answers), ["tone"]);
	assert.deepEqual(
		result.laymanExplanation?.questions.map((question) => question.id),
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
	component.handleInput("l");
	component.handleInput("\t");
	component.handleInput("1");
	component.handleInput("l");
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
	component.handleInput("l");
	component.handleInput("\r");
	component.handleInput("1");
	component.handleInput("1");
	const result = await resultPromise;
	assert.deepEqual(result.answers.storage.values, ["sql"]);
	assert.equal(result.laymanExplanation?.questions.length, 1);
});
