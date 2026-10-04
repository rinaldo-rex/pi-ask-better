import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { registerAskTool } from "../src/ask-tool.ts";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import { getAskConfigStore } from "../src/config/store.ts";
import { registerPausedAskResume } from "../src/paused-ask.ts";
import { findPausedAsk } from "../src/paused-ask-store.ts";
import {
	createRemoteAskRuntime,
	PI_ASK_COMPLETED_EVENT,
	PI_ASK_STARTED_EVENT,
	PI_ASK_SUBMIT_EVENT,
} from "../src/remote-ask.ts";
import { createInitialState } from "../src/state/create.ts";
import type { AskParams, AskResult } from "../src/types.ts";
import { DIRTY_DISMISS_NOTICE } from "../src/ui/dismiss-guard.ts";

interface Component {
	dispose: () => void;
	handleInput: (data: string) => void;
	render: (width: number) => string[];
}
interface Tool {
	execute: (...args: any[]) => Promise<any>;
	parameters: any;
}
const noop = () => {
	// These lifecycle tests do not need a terminal renderer or notifications.
};

const params: AskParams = {
	title: "Choices",
	questions: ["first", "second", "third"].map((id) => ({
		id,
		label: id,
		prompt: `Choose ${id}`,
		options: [
			{ value: "a", label: "Alpha" },
			{ value: "b", label: "Beta" },
		],
	})),
};

function harness() {
	getAskConfigStore().setConfig({
		...DEFAULT_ASK_CONFIG,
		notifications: { ...DEFAULT_ASK_CONFIG.notifications, enabled: false },
	});
	const branch: unknown[] = [];
	const tools = new Map<string, Tool>();
	const commands = new Map<
		string,
		{ handler: (...args: any[]) => Promise<void> }
	>();
	const handlers = new Map<string, (event: any, ctx: any) => unknown>();
	const messages: string[] = [];
	const widgets: unknown[] = [];
	const events: Array<{ channel: string; data: any }> = [];
	const listeners = new Map<string, (data: unknown) => void>();
	const bus = {
		on(channel: string, listener: (data: unknown) => void) {
			listeners.set(channel, listener);
			return () => listeners.delete(channel);
		},
		emit(channel: string, data: unknown) {
			events.push({ channel, data });
			listeners.get(channel)?.(data);
		},
	};
	const remote = createRemoteAskRuntime(bus as never);
	let failSaving = false;
	let component: Component | undefined;
	let openCount = 0;
	let callCount = 0;
	let opened: (() => void) | undefined;
	let openPromise = new Promise<void>((resolve) => {
		opened = resolve;
	});
	const ctx = {
		mode: "tui",
		cwd: process.cwd(),
		isIdle: () => true,
		sessionManager: { getBranch: () => branch },
		ui: {
			setWidget(_key: string, value: unknown) {
				widgets.push(value);
			},
			setWorkingVisible: noop,
			notify: noop,
			custom(factory: (...args: any[]) => Component) {
				return new Promise<AskResult>((resolve) => {
					component = factory(
						{ requestRender: noop },
						{
							fg: (_color: string, text: string) => text,
							bg: (_color: string, text: string) => text,
							bold: (text: string) => text,
						},
						{},
						(result: AskResult) => {
							component?.dispose();
							resolve(result);
						}
					);
					openCount++;
					opened?.();
				});
			},
		},
	};
	const pi = {
		appendEntry(customType: string, data: unknown) {
			if (failSaving && customType === "ask:paused") {
				throw new Error("disk is read-only");
			}
			branch.push({
				type: "custom",
				customType,
				data: JSON.parse(JSON.stringify(data)),
			});
		},
		registerTool(tool: Tool & { name: string }) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
		on(event: string, handler: (event: any, ctx: any) => unknown) {
			handlers.set(event, handler);
		},
		sendUserMessage(text: string) {
			messages.push(text);
		},
	};
	const pause = registerPausedAskResume(pi as never, remote);
	registerAskTool(pi as never, remote, pause);
	return {
		branch,
		bus,
		events,
		remote,
		failSaving() {
			failSaving = true;
		},
		commands,
		ctx,
		handlers,
		messages,
		pause,
		tools,
		widgets,
		get openCount() {
			return openCount;
		},
		execute(name: string, input: unknown, signal?: AbortSignal) {
			return tools
				.get(name)
				?.execute(
					`call-${++callCount}`,
					input,
					signal,
					undefined,
					ctx
				) as Promise<any>;
		},
		waitForOpen() {
			return openPromise;
		},
		prepareNextOpen() {
			openPromise = new Promise<void>((resolve) => {
				opened = resolve;
			});
		},
		key(data: string) {
			assert(component);
			component.handleInput(data);
		},
		render(width = 80) {
			assert(component);
			return component.render(width).join("\n");
		},
	};
}

test("Shift+L yields the tool immediately and resume restores answers, notes and the active tab", async () => {
	const h = harness();
	const ask = h.execute("ask_user", params);
	await h.waitForOpen();
	h.key("1"); // Answer first, advancing to second.
	h.key("N"); // A question note.
	h.key("Please explain this one");
	h.key("\r");
	h.key("L");
	const result = await ask;
	assert.equal(result.details.mode, "pause");
	assert.equal(result.details.pause.questionId, "second");
	assert.deepEqual(result.details.answers.first.values, ["a"]);
	const saved = findPausedAsk(h.ctx as never);
	assert(saved);
	assert.equal(saved.state.activeTabIndex, 1);
	assert.equal(saved.state.answers.second.note, "Please explain this one");
	assert.equal(typeof h.widgets.at(-1), "function");
	h.prepareNextOpen();
	const resumed = h.execute("resume_ask_user", { pauseId: saved.id });
	await h.waitForOpen();
	assert(h.render().includes("Choose second"));
	assert(h.render().includes("Please explain this one"));
	assert.equal(h.widgets.at(-1), undefined);
	h.key("2"); // Answer second, advancing to third.
	h.key("1"); // Answer third, advancing to Review.
	h.key("\r"); // Submit.
	const completed = await resumed;
	assert.equal(completed.details.mode, "submit");
	assert.deepEqual(completed.details.answers.first.values, ["a"]);
	assert.deepEqual(completed.details.answers.second.values, ["b"]);
	assert.equal(
		completed.details.answers.second.note,
		"Please explain this one"
	);
	assert.equal(findPausedAsk(h.ctx as never), undefined);
	assert.equal(h.widgets.at(-1), undefined);
	await assert.rejects(h.execute("resume_ask_user", { pauseId: saved.id }));
});

test("repeated pauses issue fresh ids, preserve deferred flags, and resolve only the old checkpoint", async () => {
	const h = harness();
	const ask = h.execute("ask_user", params);
	await h.waitForOpen();
	h.key("l"); // Defer first.
	h.key("\t");
	h.key("L"); // Explain second now.
	const initial = await ask;
	const oldId = initial.details.pause.id;
	h.prepareNextOpen();
	const resume = h.execute("resume_ask_user", { pauseId: oldId });
	await h.waitForOpen();
	h.key("\t");
	h.key("L"); // Explain third now.
	const secondPause = await resume;
	assert.equal(secondPause.details.mode, "pause");
	assert.notEqual(secondPause.details.pause.id, oldId);
	assert.equal(findPausedAsk(h.ctx as never, oldId), undefined);
	assert.equal(
		findPausedAsk(h.ctx as never)?.state.answers.first.laymanRequested,
		true
	);
	assert.equal(secondPause.details.laymanExplanation.questions[0].id, "third");
	assert.equal(secondPause.details.laymanExplanation.questions.length, 1);
});

test("invalid revisions, non-TUI use, and a replacement ask do not consume the saved form", async () => {
	const h = harness();
	const state = createInitialState(params);
	state.answers.first = {
		selected: [{ value: "a", label: "Alpha", index: 1 }],
	};
	state.activeTabIndex = 1;
	const result = h.pause.save(h.ctx as never, state);
	const pauseId = result.pause?.id;
	const revision = {
		...params.questions[0],
		prompt: "Changed already answered question",
	};
	await assert.rejects(
		h.execute("resume_ask_user", { pauseId, questions: [revision] })
	);
	assert.equal(h.openCount, 0);
	h.ctx.mode = "rpc";
	await assert.rejects(h.execute("resume_ask_user", { pauseId }));
	h.ctx.mode = "tui";
	assert(findPausedAsk(h.ctx as never, pauseId));
	const blocked = await h.execute("ask_user", params);
	assert.equal(blocked.isError, true);
	assert.equal(h.openCount, 0);
	assert(findPausedAsk(h.ctx as never, pauseId));
});

test("aborting or navigating during resumed input preserves the checkpoint for retry", async () => {
	for (const action of ["abort", "session_before_tree"]) {
		const h = harness();
		const pauseId = h.pause.save(h.ctx as never, createInitialState(params))
			.pause?.id;
		const abort = new AbortController();
		const resume = h.execute("resume_ask_user", { pauseId }, abort.signal);
		await h.waitForOpen();
		if (action === "abort") {
			abort.abort();
		} else {
			h.handlers.get(action)?.({}, h.ctx);
		}
		const result = await resume;
		assert.equal(result.details.cancelled, true);
		assert(findPausedAsk(h.ctx as never, pauseId));
		assert.equal(typeof h.widgets.at(-1), "function");
	}
});

test("user cancellation consumes a resumed checkpoint and clears the frozen widget", async () => {
	const h = harness();
	const pauseId = h.pause.save(h.ctx as never, createInitialState(params)).pause
		?.id;
	const resume = h.execute("resume_ask_user", { pauseId });
	await h.waitForOpen();
	h.key("\u0003");
	const result = await resume;
	assert.equal(result.details.cancelled, true);
	assert.equal(findPausedAsk(h.ctx as never, pauseId), undefined);
	assert.equal(h.widgets.at(-1), undefined);
});

test("startup and tree changes restore only a passive branch-local summary", () => {
	const h = harness();
	h.pause.save(h.ctx as never, createInitialState(params));
	for (const event of ["session_start", "session_tree"]) {
		h.handlers.get(event)?.({ reason: "resume" }, h.ctx);
		assert.equal(typeof h.widgets.at(-1), "function");
		assert.equal(h.openCount, 0);
	}
	h.branch.length = 0;
	h.handlers.get("session_tree")?.({}, h.ctx);
	assert.equal(h.widgets.at(-1), undefined);
});

test("save failure leaves the original questionnaire usable with its answers intact", async () => {
	const h = harness();
	const ask = h.execute("ask_user", params);
	await h.waitForOpen();
	h.key("1");
	h.failSaving();
	h.key("L");
	assert(h.render(160).includes("disk is read-only"));
	assert.equal(findPausedAsk(h.ctx as never), undefined);
	h.key("2");
	h.key("1");
	h.key("\r");
	const result = await ask;
	assert.equal(result.details.mode, "submit");
	assert.deepEqual(result.details.answers.first.values, ["a"]);
	assert.deepEqual(result.details.answers.second.values, ["b"]);
});

test("a save error does not accidentally confirm dismissal of dirty answers", async () => {
	const h = harness();
	const ask = h.execute("ask_user", params);
	await h.waitForOpen();
	h.key("1");
	h.failSaving();
	h.key("L");
	h.key("\u0003");
	assert(h.render(160).includes(DIRTY_DISMISS_NOTICE));
	h.key("\u0003");
	assert.equal((await ask).details.cancelled, true);
});

test("resume UI failures and concurrent attempts leave the checkpoint available", async () => {
	const failed = harness();
	const id = failed.pause.save(failed.ctx as never, createInitialState(params))
		.pause?.id;
	failed.ctx.ui.custom = () => Promise.reject(new Error("UI unavailable"));
	await assert.rejects(failed.execute("resume_ask_user", { pauseId: id }));
	assert(findPausedAsk(failed.ctx as never, id));
	assert.equal(typeof failed.widgets.at(-1), "function");
	const h = harness();
	const pauseId = h.pause.save(h.ctx as never, createInitialState(params)).pause
		?.id;
	const first = h.execute("resume_ask_user", { pauseId });
	await h.waitForOpen();
	await assert.rejects(h.execute("resume_ask_user", { pauseId }));
	assert(findPausedAsk(h.ctx as never, pauseId));
	h.key("\u0003");
	await first;
});

test("Shift+L on Review cannot pause or alter the completed batch", async () => {
	const h = harness();
	const ask = h.execute("ask_user", params);
	await h.waitForOpen();
	h.key("1");
	h.key("2");
	h.key("1");
	h.key("L");
	assert.equal(findPausedAsk(h.ctx as never), undefined);
	assert(h.render().includes("Submit"));
	h.key("\r");
	const result = await ask;
	assert.equal(result.details.mode, "submit");
	assert.equal(result.details.pause, undefined);
});

test("pause completes the old remote surface and resume starts a new flow", async () => {
	const h = harness();
	const ask = h.execute("ask_user", params);
	await h.waitForOpen();
	h.key("L");
	const paused = await ask;
	const firstStarted = h.events.find(
		(event) => event.channel === PI_ASK_STARTED_EVENT
	)?.data;
	const firstCompleted = h.events.find(
		(event) => event.channel === PI_ASK_COMPLETED_EVENT
	)?.data;
	assert.equal(firstCompleted.result.mode, "pause");
	assert.equal(firstStarted.flowId, firstCompleted.flowId);
	h.bus.emit(PI_ASK_SUBMIT_EVENT, {
		version: 1,
		flowId: firstStarted.flowId,
		requestId: "stale",
		response: { kind: "cancel" },
	});
	assert.equal(h.events.at(-1)?.data.error, "flow_not_found");
	h.prepareNextOpen();
	const resume = h.execute("resume_ask_user", {
		pauseId: paused.details.pause.id,
	});
	await h.waitForOpen();
	h.key("1");
	h.key("2");
	h.key("1");
	h.key("\r");
	await resume;
	const started = h.events.filter(
		(event) => event.channel === PI_ASK_STARTED_EVENT
	);
	assert.equal(started.length, 2);
	assert.equal(started[1].data.source, "ask:continue");
	assert.notEqual(started[1].data.flowId, firstStarted.flowId);
	h.remote.disposeAll();
});

test("a new explicit pause resolves the old checkpoint even if the turn is then aborted", async () => {
	const h = harness();
	const oldId = h.pause.save(h.ctx as never, createInitialState(params)).pause
		?.id;
	const controller = new AbortController();
	const resume = h.execute(
		"resume_ask_user",
		{ pauseId: oldId },
		controller.signal
	);
	await h.waitForOpen();
	h.key("L");
	controller.abort();
	const result = await resume;
	assert.equal(result.details.mode, "pause");
	assert.equal(findPausedAsk(h.ctx as never, oldId), undefined);
	assert(findPausedAsk(h.ctx as never, result.details.pause.id));
});

test("/ask:continue restores a saved form and sends only noncancelled results", async () => {
	const h = harness();
	h.pause.save(h.ctx as never, createInitialState(params));
	const continued = h.commands.get("ask:continue")?.handler("", h.ctx);
	await h.waitForOpen();
	h.key("1");
	h.key("2");
	h.key("1");
	h.key("\r");
	await continued;
	assert.equal(h.messages.length, 1);
	assert(h.messages[0].includes("first: Alpha"));
	assert.equal(findPausedAsk(h.ctx as never), undefined);
	const resumeSchema = h.tools.get("resume_ask_user")?.parameters;
	assert.equal(Value.Check(resumeSchema, { pauseId: "id" }), true);
	assert.equal(
		Value.Check(resumeSchema, { pauseId: "id", questions: [{ id: "q" }] }),
		false
	);
});
