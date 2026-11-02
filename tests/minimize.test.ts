import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	DEFAULT_ASK_CONFIG,
	normalizeAskConfig,
	toAskConfigFileV6,
} from "../src/config/defaults.ts";
import { migrateAskConfig } from "../src/config/migrate.ts";
import type { AskConfig } from "../src/config/schema.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import { createInitialState } from "../src/state/create.ts";
import {
	enterInputMode,
	enterQuestionNoteMode,
	moveTab,
} from "../src/state/transitions.ts";
import type { AskParams, AskResult, AskState } from "../src/types.ts";
import { runAskFlow } from "../src/ui/controller.ts";
import { getInputCommand, getMinimizedInputCommand } from "../src/ui/input.ts";
import { renderAskScreen } from "../src/ui/render.ts";
import { renderFooterText } from "../src/ui/render-helpers.ts";

const CTRL_C = "\u0003";

const params: AskParams = {
	title: "Setup",
	questions: [
		{
			id: "db",
			label: "Database",
			prompt: "Which database?",
			options: [
				{ value: "postgres", label: "Postgres" },
				{ value: "sqlite", label: "SQLite" },
			],
		},
		{
			id: "tone",
			label: "Tone",
			prompt: "Which tone?",
			options: [{ value: "friendly", label: "Friendly" }],
		},
	],
};

const plainTheme = {
	fg(_color: string, text: string) {
		return text;
	},
	bg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return text;
	},
} as never;

const mockEditor = { getText: () => "", render: () => [] } as never;

function render(
	state: AskState,
	width: number,
	options: { config?: AskConfig; footerNotice?: string } = {}
): string[] {
	return renderAskScreen({
		config: options.config ?? DEFAULT_ASK_CONFIG,
		editor: mockEditor,
		footerNotice: options.footerNotice,
		minimized: true,
		state,
		theme: plainTheme,
		width,
	});
}

function configWithMain(main: Partial<AskConfig["keymaps"]["main"]>) {
	return normalizeAskConfig({
		...DEFAULT_ASK_CONFIG,
		keymaps: {
			...DEFAULT_ASK_CONFIG.keymaps,
			main: { ...DEFAULT_ASK_CONFIG.keymaps.main, ...main },
		},
	});
}

test("m toggles minimization from question and review tabs but stays text in editors", () => {
	const state = createInitialState(params);
	assert.deepEqual(getInputCommand(state, DEFAULT_ASK_CONFIG, "m"), {
		kind: "toggleMinimize",
	});
	assert.deepEqual(
		getInputCommand(moveTab(state, -1), DEFAULT_ASK_CONFIG, "m"),
		{
			kind: "toggleMinimize",
		}
	);
	for (const editorState of [
		enterInputMode(state, "db"),
		enterQuestionNoteMode(state, "db"),
	]) {
		for (const text of ["", "hello"]) {
			assert.deepEqual(
				getInputCommand(editorState, DEFAULT_ASK_CONFIG, "m", text),
				{ kind: "delegateToEditor" }
			);
		}
	}
});

test("minimized input only accepts toggle, dismiss, and settings", () => {
	assert.deepEqual(getMinimizedInputCommand(DEFAULT_ASK_CONFIG, "m"), {
		kind: "toggleMinimize",
	});
	assert.deepEqual(getMinimizedInputCommand(DEFAULT_ASK_CONFIG, CTRL_C), {
		kind: "dismiss",
	});
	assert.deepEqual(getMinimizedInputCommand(DEFAULT_ASK_CONFIG, "?"), {
		kind: "showSettings",
	});
	for (const key of ["\r", "\x1b", "\t", " ", "1", "n", "l", "h", "t"]) {
		assert.deepEqual(getMinimizedInputCommand(DEFAULT_ASK_CONFIG, key), {
			kind: "ignore",
		});
	}
});

test("toggleMinimize is rebindable and its footer hint follows the binding", () => {
	const config = configWithMain({ toggleMinimize: ["alt+m"] });
	const state = createInitialState(params);
	assert.deepEqual(getInputCommand(state, config, "m"), { kind: "ignore" });
	assert.deepEqual(getMinimizedInputCommand(config, "m"), { kind: "ignore" });
	assert.deepEqual(getInputCommand(state, config, "\u001bm"), {
		kind: "toggleMinimize",
	});
	assert.deepEqual(getMinimizedInputCommand(config, "\u001bm"), {
		kind: "toggleMinimize",
	});
	assert(renderFooterText(config, "default").includes("alt+m minimize"));
	assert(render(state, 80, { config })[1].includes("alt+m expand"));
	assert(renderFooterText(DEFAULT_ASK_CONFIG, "submit").includes("m minimize"));
	assert.equal(
		renderFooterText(DEFAULT_ASK_CONFIG, "input").includes("minimize"),
		false
	);
});

test("older keymaps gain m only when it is not already claimed", () => {
	const file = structuredClone(toAskConfigFileV6(DEFAULT_ASK_CONFIG));
	assert(file.keymaps?.main);
	file.keymaps.main.toggleMinimize = undefined;
	const result = migrateAskConfig(file);
	assert.equal(result.notice, undefined);
	assert.deepEqual(result.config.keymaps.main.toggleMinimize, ["m"]);

	file.keymaps.main.optionNote = ["m"];
	const conflict = migrateAskConfig(file);
	assert.equal(conflict.notice, undefined);
	assert.deepEqual(conflict.config.keymaps.main.optionNote, ["m"]);
	assert.deepEqual(conflict.config.keymaps.main.toggleMinimize, []);
	assert.equal(
		renderFooterText(conflict.config, "default").includes("minimize"),
		false
	);
});

test("minimized frame is a compact strip that keeps the expand hint visible", () => {
	const state = createInitialState(params);
	assert.deepEqual(render(state, 80), [
		"─".repeat(80),
		" ▸ Setup · Q1/2 Database · 0/2 answered · m expand",
		"─".repeat(80),
	]);
	assert.equal(render(state, 40)[1], " ▸ Setup · Q1/2 Database · m expand");
	assert.equal(render(state, 24)[1], " ▸ Q1/2 · m expand");
	for (const width of [12, 24, 40, 80]) {
		assert(render(state, width).every((line) => visibleWidth(line) <= width));
	}
	assert.equal(
		render(moveTab(state, -1), 80)[1],
		" ▸ Setup · Review · 0/2 answered · m expand"
	);
	const untitled = createInitialState({ ...params, title: undefined });
	assert(render(untitled, 80)[1].startsWith(" ▸ Ask · "));
});

test("minimized frame shows footer notices", () => {
	const lines = render(createInitialState(params), 80, {
		footerNotice: "Press dismiss again to discard.",
	});
	assert.deepEqual(lines.slice(1, -1), [
		" ▸ Setup · Q1/2 Database · 0/2 answered · m expand",
		"Press dismiss again to discard.",
	]);
});

interface TestComponent {
	dispose(): void;
	handleInput(data: string): void;
	render(width: number): string[];
}

async function startFlow(): Promise<{
	component: TestComponent;
	resultPromise: Promise<AskResult>;
}> {
	getAskConfigStore().setConfig({
		...DEFAULT_ASK_CONFIG,
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
							plainTheme,
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

test("controller minimizes, ignores answer keys, and expands with answers intact", {
	timeout: 5000,
}, async (t) => {
	const { component, resultPromise } = await startFlow();
	t.after(() => {
		component.dispose();
		getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
	});
	component.handleInput("2");
	component.handleInput("m");
	assert.deepEqual(component.render(80).slice(1, -1), [
		" ▸ Setup · Q2/2 Tone · 1/2 answered · m expand",
	]);
	for (const key of ["\r", "1", "\t", "\x1b", "n"]) {
		component.handleInput(key);
	}
	assert.equal(component.render(80).length, 3);
	component.handleInput("m");
	assert(component.render(80).some((line) => line.includes("Which tone?")));
	component.handleInput("1");
	component.handleInput("\r");
	const result = await resultPromise;
	assert.deepEqual(result.answers.db.values, ["sqlite"]);
	assert.deepEqual(result.answers.tone.values, ["friendly"]);
});

test("controller dismiss confirmation works while minimized", {
	timeout: 5000,
}, async (t) => {
	const { component, resultPromise } = await startFlow();
	t.after(() => {
		component.dispose();
		getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
	});
	component.handleInput("1");
	component.handleInput("m");
	component.handleInput(CTRL_C);
	const minimized = component.render(80);
	assert(minimized.length > 3);
	assert(minimized.some((line) => line.includes("discard")));
	component.handleInput(CTRL_C);
	assert.equal((await resultPromise).cancelled, true);
});

test("controller expands when a live config change unbinds minimize", {
	timeout: 5000,
}, async (t) => {
	const { component } = await startFlow();
	t.after(() => {
		component.dispose();
		getAskConfigStore().setConfig(DEFAULT_ASK_CONFIG);
	});
	component.handleInput("m");
	assert.equal(component.render(80).length, 3);
	getAskConfigStore().setConfig(configWithMain({ toggleMinimize: [] }));
	assert(component.render(80).length > 3);
});
