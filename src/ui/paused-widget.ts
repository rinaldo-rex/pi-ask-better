import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { PausedAsk } from "../paused-ask-store.ts";
import { isAnswerAnswered } from "../state/answers.ts";
import type { AskStateAnswer } from "../types.ts";

const PAUSED_WIDGET = "ask-paused";
const MAX_VISIBLE_QUESTIONS = 5;

function answerStatus(answer?: AskStateAnswer): string {
	if (answer?.laymanRequested) {
		return "explanation deferred";
	}
	if (answer?.uiVariationsRequested) {
		return "ui variations deferred";
	}
	if (!isAnswerAnswered(answer)) {
		return "unanswered";
	}
	const labels = answer?.selected.map((item) => item.label) ?? [];
	if (answer?.customSelected && answer.customText) {
		labels.push(answer.customText);
	}
	return `saved: ${labels.join(", ")}`;
}

export function pausedWidgetLines(paused: PausedAsk): string[] {
	const { state } = paused;
	const start = Math.max(0, state.activeTabIndex - MAX_VISIBLE_QUESTIONS + 1);
	const visible = state.questions.slice(start, start + MAX_VISIBLE_QUESTIONS);
	const uiVariations = paused.request === "uiVariations";
	const currentStatus = uiVariations
		? "generating mockups now"
		: "explaining now";
	const pauseReason = uiVariations ? "ui variation mockups" : "explanation";
	return [
		`${state.title ?? "Questionnaire"} — paused for ${pauseReason} (not submitted)`,
		...visible.map((question, offset) => {
			const answer = state.answers[question.id];
			const current = start + offset === state.activeTabIndex;
			const noteCount =
				(answer?.note ? 1 : 0) + Object.keys(answer?.optionNotes ?? {}).length;
			return `${current ? "→" : "·"} ${question.label}: ${current ? currentStatus : answerStatus(answer)}${noteCount ? ` (${noteCount} saved note(s))` : ""}`;
		}),
		...(visible.length < state.questions.length
			? [
					`${state.questions.length} questions saved; showing ${start + 1}–${start + visible.length}.`,
				]
			: []),
		uiVariations
			? "Agent will resume after generating the mockups. /ask:continue reopens manually."
			: "Agent will resume after explaining. /ask:continue reopens manually.",
	].map((line) => line.replace(/\r?\n/g, " "));
}

export function showPausedWidget(
	ctx: ExtensionContext,
	paused?: PausedAsk
): void {
	if (ctx.mode !== "tui") {
		return;
	}
	if (!paused) {
		ctx.ui.setWidget(PAUSED_WIDGET, undefined);
		return;
	}
	ctx.ui.setWidget(PAUSED_WIDGET, (_tui, theme) => ({
		render: (width) =>
			pausedWidgetLines(paused).map((line) =>
				theme.fg("dim", truncateToWidth(line, width))
			),
		invalidate() {
			// Lines are derived at render time, including the current theme.
		},
	}));
}
