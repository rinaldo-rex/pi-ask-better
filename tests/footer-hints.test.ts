import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_ASK_CONFIG,
	normalizeAskConfig,
	toAskConfigFileV6,
} from "../src/config/defaults.ts";
import { migrateAskConfig } from "../src/config/migrate.ts";
import type { AskConfig } from "../src/config/schema.ts";
import {
	type FooterKeymapContext,
	HIDEABLE_FOOTER_HINTS,
	normalizeHiddenFooterHints,
} from "../src/constants/keymaps.ts";
import { createInitialState } from "../src/state/create.ts";
import { getInputCommand } from "../src/ui/input.ts";
import { renderFooterText } from "../src/ui/render-helpers.ts";
import { AskSettingsList } from "../src/ui/settings-list.ts";

const DOWN = "\x1b[B";
const ESC = "\x1b";
const FOOTER_CONTEXTS: FooterKeymapContext[] = [
	"default",
	"multi",
	"layman",
	"uiVariations",
	"submit",
	"input",
	"note",
];

function withHidden(hiddenFooterHints: unknown): AskConfig {
	return normalizeAskConfig({
		...DEFAULT_ASK_CONFIG,
		behaviour: {
			...DEFAULT_ASK_CONFIG.behaviour,
			hiddenFooterHints: hiddenFooterHints as string[],
		},
	});
}

test("hidden footer hints are deduplicated and drop unknown or locked ids", () => {
	assert.deepEqual(
		normalizeHiddenFooterHints([
			"main.requestUiVariations",
			"bogus",
			"main.requestUiVariations",
			"global.settings",
			42,
		]),
		{
			hidden: ["main.requestUiVariations"],
			ignored: ["bogus", "global.settings"],
		}
	);
	assert.deepEqual(normalizeHiddenFooterHints(undefined), {
		hidden: [],
		ignored: [],
	});
	assert.deepEqual(DEFAULT_ASK_CONFIG.behaviour.hiddenFooterHints, []);
});

test("footer omits hidden hints on every screen while keys keep working", () => {
	const config = withHidden([
		"main.requestLaymanExplanation",
		"main.requestImmediateUiVariations",
		"numberShortcut",
		"editor.close",
	]);
	for (const context of FOOTER_CONTEXTS) {
		const footer = renderFooterText(config, context);
		assert.equal(footer.includes("layman explanation"), false, context);
		assert.equal(footer.includes("undo explanation"), false, context);
		assert.equal(footer.includes("mockups now"), false, context);
		assert.equal(footer.includes("hotkeys"), false, context);
		assert(footer.endsWith("? settings"), context);
	}
	assert.equal(renderFooterText(config, "input"), " Enter submit · ? settings");
	assert.equal(
		renderFooterText(config, "note"),
		" Enter save · Esc close · ? settings"
	);
	assert(renderFooterText(config, "default").includes("h ui variations"));
	assert.deepEqual(
		getInputCommand(
			createInitialState({
				questions: [
					{ id: "q", prompt: "Q", options: [{ value: "a", label: "A" }] },
				],
			}),
			config,
			"l"
		),
		{ kind: "requestLaymanExplanation" }
	);
});

test("hiding every hideable hint leaves only the settings hint", () => {
	const config = withHidden(HIDEABLE_FOOTER_HINTS.map((hint) => hint.id));
	for (const context of FOOTER_CONTEXTS) {
		assert.equal(renderFooterText(config, context), " ? settings", context);
	}
});

test("config files persist hidden hints and warn about ignored ids", () => {
	const file = structuredClone(toAskConfigFileV6(DEFAULT_ASK_CONFIG));
	assert.deepEqual(file.behaviour?.hiddenFooterHints, []);
	assert(file.behaviour);

	file.behaviour.hiddenFooterHints = undefined;
	const missing = migrateAskConfig(file);
	assert.deepEqual(missing.config.behaviour.hiddenFooterHints, []);
	assert.equal(missing.notice, undefined);

	file.behaviour.hiddenFooterHints = ["main.toggleMinimize"];
	const valid = migrateAskConfig(file);
	assert.deepEqual(valid.config.behaviour.hiddenFooterHints, [
		"main.toggleMinimize",
	]);
	assert.equal(valid.notice, undefined);
	assert.deepEqual(
		toAskConfigFileV6(valid.config).behaviour?.hiddenFooterHints,
		["main.toggleMinimize"]
	);

	file.behaviour.hiddenFooterHints = [
		"main.toggleMinimize",
		"main.typo",
		"global.settings",
	];
	const invalid = migrateAskConfig(file);
	assert.deepEqual(invalid.config.behaviour.hiddenFooterHints, [
		"main.toggleMinimize",
	]);
	assert(invalid.notice?.includes("main.typo, global.settings"));
	assert.deepEqual(invalid.config.keymaps, DEFAULT_ASK_CONFIG.keymaps);
});

function createList(
	onSave: (config: AskConfig) => Promise<AskConfig> = (config) =>
		Promise.resolve(config)
) {
	const events = { closed: 0 };
	const list = new AskSettingsList(
		{
			bg: (_color: string, text: string) => text,
			fg: (_color: string, text: string) => text,
		},
		{
			configPath: "/tmp/eko24ive-pi-ask.json",
			onClose: () => {
				events.closed += 1;
			},
			onSave,
			savedConfig: DEFAULT_ASK_CONFIG,
			tui: {
				requestRender() {
					// no-op in tests
				},
			},
		}
	);
	return { events, list };
}

function openFooterHintsPage(list: AskSettingsList) {
	for (let index = 0; index < 5; index++) {
		list.handleInput(DOWN);
	}
	assert(list.render(72).some((line) => line.includes("❯ Footer hints")));
	list.handleInput("\r");
}

test("settings footer-hints page toggles, saves, and returns with close keys", async () => {
	let saved: AskConfig | undefined;
	const { events, list } = createList((config) => {
		saved = config;
		return Promise.resolve(config);
	});
	assert(list.render(72).some((line) => line.includes("[16/16 shown]")));

	openFooterHintsPage(list);
	let text = list.render(72).join("\n");
	assert(text.includes("Hidden hints keep working"));
	assert(text.includes("L        layman explanation / undo"));
	assert(text.includes("[always on]"));
	assert(text.includes("to go back"));

	for (let index = 0; index < 4; index++) {
		list.handleInput(DOWN);
	}
	list.handleInput(" ");
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(saved?.behaviour.hiddenFooterHints, [
		"main.requestLaymanExplanation",
	]);
	text = list.render(72).join("\n");
	assert(text.includes("❯ L        layman explanation / undo"));
	assert(text.includes("[off]"));

	list.handleInput(ESC);
	assert.equal(events.closed, 0);
	assert(list.render(72).some((line) => line.includes("[15/16 shown]")));
	list.handleInput(ESC);
	assert.equal(events.closed, 1);
});

test("settings footer-hints page keeps the settings hint locked and reverts failed saves", async () => {
	const { list } = createList(() => Promise.reject(new Error("disk nope")));
	openFooterHintsPage(list);

	list.handleInput("\x1b[A");
	assert(list.render(72).some((line) => line.includes("❯ ?")));
	list.handleInput(" ");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		list.render(72).some((line) => line.includes("disk nope")),
		false
	);

	list.handleInput(DOWN);
	list.handleInput(" ");
	await new Promise((resolve) => setImmediate(resolve));
	const text = list.render(72).join("\n");
	assert(text.includes("disk nope"));
	assert.equal(text.includes("[off]"), false);
});
