import type {
	AskQuestion,
	AskQuestionInput,
	AskResult,
	AskState,
	AskStateAnswer,
} from "../types.ts";
import { isAnswerAnswered } from "./answers.ts";
import { normalizeQuestions } from "./normalize.ts";
import { toAskResult } from "./result.ts";
import { getCurrentQuestion, isSubmitTab } from "./selectors.ts";

export function canPauseAsk(state: AskState): boolean {
	return (
		!(state.completed || state.cancelled) &&
		state.view.kind === "navigate" &&
		!isSubmitTab(state) &&
		!!getCurrentQuestion(state)
	);
}

export function createPauseResult(state: AskState, pauseId: string): AskResult {
	if (!canPauseAsk(state)) {
		throw new Error(
			"Only an active question can request immediate explanation."
		);
	}
	const question = state.questions[state.activeTabIndex];
	const requestedState = structuredClone(state);
	requestedState.answers[question.id] = {
		...requestedState.answers[question.id],
		selected: requestedState.answers[question.id]?.selected ?? [],
		laymanRequested: true,
	};
	const result = toAskResult(requestedState);
	return {
		...result,
		mode: "pause",
		pause: { id: pauseId, questionId: question.id },
		laymanExplanation: {
			instruction:
				"Explain only the immediate question now in everyday language. Explain every option and its differences with concrete inline examples. Do not act on draft answers or flush deferred explanation requests. Then call resume_ask_user with the pauseId to restore the saved questionnaire, optionally revising only the current or unanswered questions. Do not start a new ask_user batch.",
			questions:
				result.laymanExplanation?.questions.filter(
					(item) => item.id === question.id
				) ?? [],
		},
		continuation: result.continuation
			? {
					...result.continuation,
					strategy: "resume",
					affectedQuestionIds: [question.id],
				}
			: undefined,
	};
}

export function resumePausedState(
	state: AskState,
	revisions: AskQuestionInput[] = [],
	options: { allowFreeform?: boolean } = {}
): AskState {
	if (!canPauseAsk(state)) {
		throw new Error(
			"The saved questionnaire is not a resumable question state."
		);
	}
	const next = structuredClone(state);
	const activeId = next.questions[next.activeTabIndex].id;
	const replacements = revisions.map((revision) => {
		const previous = next.questions.find(
			(question) => question.id === revision.id.trim()
		);
		return {
			...revision,
			label: revision.label ?? previous?.label,
			type: revision.type ?? previous?.requestedType ?? previous?.type,
			required: revision.required ?? previous?.required,
		};
	});
	const revised = replacements.length
		? normalizeQuestions({ questions: replacements }, options)
		: [];
	for (const question of revised) {
		applyRevision(next, question, activeId);
	}
	if (next.answers[activeId]) {
		next.answers[activeId].laymanRequested = undefined;
	}
	const activeOption =
		state.questions[state.activeTabIndex].options[state.activeOptionIndex];
	const currentOptions = next.questions[next.activeTabIndex].options;
	next.activeOptionIndex = activeOption
		? Math.max(
				0,
				currentOptions.findIndex(
					(option) => option.value === activeOption.value
				)
			)
		: currentOptions.length;
	return next;
}

function applyRevision(
	state: AskState,
	question: AskQuestion,
	activeId: string
): void {
	const index = state.questions.findIndex((item) => item.id === question.id);
	if (index < 0) {
		throw new Error(
			`Cannot revise unknown question ${JSON.stringify(question.id)}.`
		);
	}
	const previous = state.questions[index];
	const answer = state.answers[question.id];
	if (question.id !== activeId && isAnswerAnswered(answer)) {
		throw new Error(
			`Cannot revise answered question ${JSON.stringify(question.id)}.`
		);
	}
	// Rewording must not undo the user's live presentation override.
	if (question.type === (previous.requestedType ?? previous.type)) {
		question.type = previous.type;
		question.requestedType = previous.requestedType;
		question.presentedType = previous.presentedType;
	}
	if (answer) {
		reconcileAnswer(question, answer);
	}
	state.questions[index] = question;
}

function reconcileAnswer(question: AskQuestion, answer: AskStateAnswer): void {
	const retainedValues = new Set([
		...answer.selected.map((selection) => selection.value),
		...Object.keys(answer.optionNotes ?? {}),
	]);
	if (
		[...retainedValues].some(
			(value) => !question.options.some((option) => option.value === value)
		)
	) {
		throw new Error(
			`Revision of ${JSON.stringify(question.id)} would discard a saved selection or option note. Keep its option values.`
		);
	}
	const count =
		answer.selected.length +
		(answer.customSelected && answer.customText?.trim() ? 1 : 0);
	if (question.type !== "multi" && count > 1) {
		throw new Error(
			`Revision of ${JSON.stringify(question.id)} would discard multiple saved answers.`
		);
	}
	answer.selected = question.options.flatMap((option, optionIndex) =>
		answer.selected.some((selection) => selection.value === option.value)
			? [{ value: option.value, label: option.label, index: optionIndex + 1 }]
			: []
	);
}
