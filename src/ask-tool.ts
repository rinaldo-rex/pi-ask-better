import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { appendAskPayload } from "./ask-payload-store.ts";
import {
	ASK_TOOL_DESCRIPTION,
	ASK_TOOL_PROMPT_GUIDELINES,
	invalidPayloadResponse,
	nonInteractiveResponse,
	renderAskToolCall,
	renderAskToolResult,
	successfulResponse,
	validateParams,
} from "./ask-tool-helpers.ts";
import { getAskConfigStore } from "./config/store.ts";
import type { AskPauseRuntime } from "./paused-ask.ts";
import { findPausedAsk } from "./paused-ask-store.ts";
import type { RemoteAskRuntime } from "./remote-ask.ts";
import { AskParamsSchema } from "./schema.ts";
import { prepareAskParams } from "./state/normalize.ts";
import { createPauseResult } from "./state/pause.ts";
import type { AskParams } from "./types.ts";
import { runAskFlow } from "./ui/controller.ts";

export function registerAskTool(
	pi: ExtensionAPI,
	remoteAsk?: RemoteAskRuntime,
	pause?: AskPauseRuntime
) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description: ASK_TOOL_DESCRIPTION,
		promptSnippet:
			"Clarify ambiguous or preference-sensitive decisions with a short interactive interview before proceeding",
		promptGuidelines: [...ASK_TOOL_PROMPT_GUIDELINES],
		parameters: AskParamsSchema,
		prepareArguments: (args) => prepareAskParams(args) as AskParams,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			executeAskTool(
				pi,
				toolCallId,
				params as AskParams,
				signal,
				onUpdate,
				ctx,
				remoteAsk,
				pause
			),
		renderCall: renderAskToolCall,
		renderResult: renderAskToolResult,
	});
}

async function executeAskTool(
	pi: Pick<ExtensionAPI, "appendEntry">,
	toolCallId: string,
	params: AskParams,
	signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: ExtensionContext,
	remoteAsk?: RemoteAskRuntime,
	pause?: AskPauseRuntime
) {
	const config = await getAskConfigStore().getConfig();
	const validation = validateParams(params, {
		presentSingleAsMulti: config.behaviour.presentSingleAsMulti,
	});
	if (!validation.ok) {
		return invalidPayloadResponse(params, validation.issues);
	}
	const paused = pause && ctx.mode === "tui" ? findPausedAsk(ctx) : undefined;
	if (paused) {
		return {
			...successfulResponse(createPauseResult(paused.state, paused.id)),
			isError: true,
		};
	}
	appendAskPayload(pi, {
		params,
		source: "tool",
		sourceEntryId: toolCallId,
	});
	if (ctx.mode !== "tui") {
		return nonInteractiveResponse(validation.state);
	}
	ctx.ui.setWorkingVisible(false);
	try {
		const result = await runAskFlow(ctx, params, {
			pause,
			pendingToolCallId: toolCallId,
			signal,
			remote: remoteAsk
				? { runtime: remoteAsk, source: "tool", toolCallId }
				: undefined,
		});
		return successfulResponse(result);
	} finally {
		ctx.ui.setWorkingVisible(true);
	}
}
