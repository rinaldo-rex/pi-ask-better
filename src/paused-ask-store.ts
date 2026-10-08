import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { AskOptionSchema } from "./schema.ts";
import { collectValidationIssues } from "./state/normalize.ts";
import { canPauseAsk } from "./state/pause.ts";
import { getRenderableOptions } from "./state/selectors.ts";
import type { AskPauseRequest, AskState } from "./types.ts";

export const ASK_PAUSED_ENTRY_TYPE = "ask:paused";
export const ASK_PAUSE_RESOLVED_ENTRY_TYPE = "ask:pause-resolved";

export interface PausedAsk {
	allowFreeform: boolean;
	id: string;
	pendingToolCallId?: string;
	request?: AskPauseRequest;
	state: AskState;
	version: 1;
}

const QuestionTypeSchema = Type.Union([
	Type.Literal("single"),
	Type.Literal("multi"),
	Type.Literal("preview"),
]);
const PauseRequestSchema = Type.Optional(
	Type.Union([Type.Literal("layman"), Type.Literal("uiVariations")])
);
const OptionalText = Type.Optional(Type.String());
const SnapshotSchema = Type.Object({
	version: Type.Literal(1),
	id: Type.String({ minLength: 1 }),
	allowFreeform: Type.Boolean(),
	pendingToolCallId: OptionalText,
	request: PauseRequestSchema,
	state: Type.Object({
		title: OptionalText,
		activeOptionIndex: Type.Integer({ minimum: 0 }),
		activeSubmitActionIndex: Type.Integer({ minimum: 0, maximum: 2 }),
		activeTabIndex: Type.Integer({ minimum: 0 }),
		cancelled: Type.Literal(false),
		completed: Type.Literal(false),
		mode: Type.Union([Type.Literal("submit"), Type.Literal("elaborate")]),
		view: Type.Object({ kind: Type.Literal("navigate") }),
		questions: Type.Array(
			Type.Object({
				id: Type.String(),
				label: Type.String(),
				prompt: Type.String(),
				type: QuestionTypeSchema,
				requestedType: Type.Optional(QuestionTypeSchema),
				presentedType: Type.Optional(QuestionTypeSchema),
				required: Type.Boolean(),
				options: Type.Array(
					Type.Object({
						...AskOptionSchema.properties,
						freeform: Type.Optional(Type.Boolean()),
					})
				),
			}),
			{ minItems: 1 }
		),
		answers: Type.Record(
			Type.String(),
			Type.Object({
				selected: Type.Array(
					Type.Object({
						value: Type.String(),
						label: Type.String(),
						index: Type.Integer({ minimum: 1 }),
					})
				),
				customSelected: Type.Optional(Type.Boolean()),
				customText: OptionalText,
				laymanRequested: Type.Optional(Type.Boolean()),
				note: OptionalText,
				optionNotes: Type.Optional(Type.Record(Type.String(), Type.String())),
				uiVariationsRequested: Type.Optional(Type.Boolean()),
			})
		),
	}),
});

export function isValidPausedAsk(data: unknown): data is PausedAsk {
	if (!(Value.Check(SnapshotSchema, data) && canPauseAsk(data.state))) {
		return false;
	}
	const { state } = data;
	if (
		state.activeOptionIndex >=
		getRenderableOptions(state.questions[state.activeTabIndex]).length
	) {
		return false;
	}
	const issues = collectValidationIssues(
		{
			questions: state.questions.map((question) => ({
				...question,
				type: question.requestedType ?? question.type,
			})),
		},
		{ allowFreeform: data.allowFreeform }
	);
	if (issues.length) {
		return false;
	}
	return Object.entries(state.answers).every(([id, answer]) => {
		const question = state.questions.find((item) => item.id === id);
		if (
			!question ||
			new Set(answer.selected.map((item) => item.value)).size !==
				answer.selected.length
		) {
			return false;
		}
		if (
			question.type !== "multi" &&
			answer.selected.length +
				(answer.customSelected && answer.customText?.trim() ? 1 : 0) >
				1
		) {
			return false;
		}
		return (
			answer.selected.every((selection) => {
				const option = question.options[selection.index - 1];
				return (
					option?.value === selection.value && option.label === selection.label
				);
			}) &&
			Object.keys(answer.optionNotes ?? {}).every((value) =>
				question.options.some((option) => option.value === value)
			)
		);
	});
}

export function appendPausedAsk(
	pi: Pick<ExtensionAPI, "appendEntry">,
	data: PausedAsk
): void {
	if (!isValidPausedAsk(data)) {
		throw new Error("Cannot save an invalid paused questionnaire.");
	}
	pi.appendEntry(ASK_PAUSED_ENTRY_TYPE, structuredClone(data));
}

export function resolvePausedAsk(
	pi: Pick<ExtensionAPI, "appendEntry">,
	id: string
): void {
	pi.appendEntry(ASK_PAUSE_RESOLVED_ENTRY_TYPE, { version: 1, id });
}

export function findPausedAsk(
	ctx: Pick<ExtensionContext, "sessionManager">,
	id?: string
): PausedAsk | undefined {
	const resolved = new Set<string>();
	for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
		if (entry.type !== "custom") {
			continue;
		}
		if (entry.customType === ASK_PAUSE_RESOLVED_ENTRY_TYPE) {
			const resolvedId = readResolvedId(entry.data);
			if (resolvedId) {
				resolved.add(resolvedId);
			}
		}
		if (
			entry.customType === ASK_PAUSED_ENTRY_TYPE &&
			isValidPausedAsk(entry.data) &&
			!resolved.has(entry.data.id) &&
			(id === undefined || entry.data.id === id)
		) {
			return structuredClone(entry.data);
		}
	}
	return;
}

function readResolvedId(data: unknown): string | undefined {
	if (!data || typeof data !== "object") {
		return;
	}
	const marker = data as { version?: unknown; id?: unknown };
	return marker.version === 1 && typeof marker.id === "string"
		? marker.id
		: undefined;
}
