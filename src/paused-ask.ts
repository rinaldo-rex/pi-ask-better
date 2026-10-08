import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderAskToolResult, successfulResponse } from "./ask-tool-helpers.ts";
import {
	appendPausedAsk,
	findPausedAsk,
	type PausedAsk,
	resolvePausedAsk,
} from "./paused-ask-store.ts";
import type { RemoteAskRuntime } from "./remote-ask.ts";
import { AskQuestionSchema } from "./schema.ts";
import { createPauseResult, resumePausedState } from "./state/pause.ts";
import type {
	AskPauseRequest,
	AskQuestionInput,
	AskResult,
	AskState,
} from "./types.ts";
import { runAskFlow } from "./ui/controller.ts";
import { showPausedWidget } from "./ui/paused-widget.ts";

export interface AskPauseRuntime {
	save: (
		ctx: ExtensionContext,
		state: AskState,
		request?: AskPauseRequest,
		allowFreeform?: boolean,
		pendingToolCallId?: string
	) => AskResult;
}

interface ResumeOptions {
	pauseId: string;
	questions?: AskQuestionInput[];
	signal?: AbortSignal;
	toolCallId?: string;
}

type Resume = (
	ctx: ExtensionContext,
	options: ResumeOptions
) => Promise<ReturnType<typeof successfulResponse>>;

export function registerPausedAskResume(
	pi: ExtensionAPI,
	remoteAsk?: RemoteAskRuntime
): AskPauseRuntime {
	const active = new Map<string, AbortController>();
	const runtime: AskPauseRuntime = {
		save(
			ctx,
			state,
			request: AskPauseRequest = "layman",
			allowFreeform = false,
			pendingToolCallId?: string
		) {
			const id = randomUUID();
			const result = createPauseResult(state, id, request);
			const paused: PausedAsk = {
				version: 1,
				id,
				state: structuredClone(state),
				allowFreeform,
				pendingToolCallId,
				request,
			};
			appendPausedAsk(pi, paused);
			showPausedWidget(ctx, paused);
			return result;
		},
	};
	const abortActive = () => {
		for (const controller of active.values()) {
			controller.abort();
		}
	};
	pi.on("session_start", (_event, ctx) =>
		showPausedWidget(ctx, findPausedAsk(ctx))
	);
	pi.on("session_tree", (_event, ctx) =>
		showPausedWidget(ctx, findPausedAsk(ctx))
	);
	pi.on("session_before_switch", abortActive);
	pi.on("session_before_fork", abortActive);
	pi.on("session_before_tree", abortActive);
	pi.on("session_shutdown", (_event, ctx) => {
		abortActive();
		showPausedWidget(ctx);
	});
	const resume: Resume = (ctx, options) =>
		resumeAsk(pi, ctx, options, runtime, active, remoteAsk);
	registerResumeTool(pi, resume);
	registerContinueCommand(pi, resume);
	return runtime;
}

function registerResumeTool(pi: ExtensionAPI, resume: Resume): void {
	pi.registerTool({
		name: "resume_ask_user",
		label: "Resume Ask User",
		description:
			"After explaining an immediate layman request or generating the requested UI variation mockups in chat, resume the saved questionnaire using its pauseId. Never reconstruct it with ask_user. Optional questions are targeted replacements with existing ids, only for the active or unanswered questions; omit unchanged questions. Preserve selected and noted option values, and do not revise other answered questions. Saved answers and notes are restored automatically.",
		parameters: Type.Object({
			pauseId: Type.String({
				description: "Opaque pause id from the paused ask_user result",
			}),
			questions: Type.Optional(
				Type.Array(AskQuestionSchema, {
					description:
						"Targeted replacements for existing current/unanswered question ids; not a new batch",
				})
			),
		}),
		execute: (toolCallId, params, signal, _onUpdate, ctx) =>
			resume(ctx, { ...params, signal, toolCallId }),
		renderResult: renderAskToolResult,
	});
}

function registerContinueCommand(pi: ExtensionAPI, resume: Resume): void {
	pi.registerCommand("ask:continue", {
		description:
			"Resume the latest paused questionnaire on this branch without revisions",
		handler: async (_args, ctx) => {
			const paused = findPausedAsk(ctx);
			if (!paused) {
				ctx.ui.notify("No paused questionnaire on this branch.", "info");
				return;
			}
			try {
				const result = await resume(ctx, { pauseId: paused.id });
				if (!result.details.cancelled) {
					pi.sendUserMessage(
						result.content[0].text,
						ctx.isIdle() ? undefined : { deliverAs: "followUp" }
					);
				}
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error"
				);
			}
		},
	});
}

async function resumeAsk(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: ResumeOptions,
	runtime: AskPauseRuntime,
	active: Map<string, AbortController>,
	remoteAsk?: RemoteAskRuntime
): Promise<ReturnType<typeof successfulResponse>> {
	if (ctx.mode !== "tui") {
		throw new Error(
			"Resuming a questionnaire requires interactive TUI mode. The saved form is unchanged."
		);
	}
	const paused = findPausedAsk(ctx, options.pauseId);
	if (!paused) {
		throw new Error(
			"No unresolved questionnaire with this pauseId exists on the current branch."
		);
	}
	if (active.size) {
		throw new Error("A paused questionnaire is already being resumed.");
	}
	const state = resumePausedState(paused.state, options.questions, {
		allowFreeform: paused.allowFreeform,
		request: paused.request,
	});
	const controller = new AbortController();
	const abort = () => controller.abort();
	options.signal?.addEventListener("abort", abort, { once: true });
	if (options.signal?.aborted) {
		abort();
	}
	active.set(paused.id, controller);
	showPausedWidget(ctx);
	ctx.ui.setWorkingVisible(false);
	try {
		const result = await runAskFlow(
			ctx,
			{ title: state.title, questions: state.questions },
			{
				initialState: state,
				allowFreeform: paused.allowFreeform,
				pause: runtime,
				pendingToolCallId: paused.pendingToolCallId,
				signal: controller.signal,
				remote: remoteAsk
					? {
							runtime: remoteAsk,
							source: "ask:continue",
							toolCallId: options.toolCallId,
						}
					: undefined,
			}
		);
		// Abort/navigation is not a user decision; keep the checkpoint for retry.
		if (result.mode === "pause" || !controller.signal.aborted) {
			resolvePausedAsk(pi, paused.id);
		}
		return successfulResponse(result);
	} finally {
		options.signal?.removeEventListener("abort", abort);
		active.delete(paused.id);
		ctx.ui.setWorkingVisible(true);
		showPausedWidget(ctx, findPausedAsk(ctx));
	}
}
