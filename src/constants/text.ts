import type { AskStateAnswer } from "../types.ts";

export function getRequestNotice(
	answer?: Pick<AskStateAnswer, "laymanRequested" | "uiVariationsRequested">
): string | undefined {
	const notices: string[] = [];
	if (answer?.laymanRequested) {
		notices.push(LAYMAN_REQUEST_NOTICE);
	}
	if (answer?.uiVariationsRequested) {
		notices.push(UI_VARIATIONS_REQUEST_NOTICE);
	}
	return notices.length ? notices.join("; ") : undefined;
}

export const OTHER_OPTION_VALUE = "__other__";
export const OTHER_OPTION_LABEL = "Type your own";
export const SUBMIT_CHOICES = ["Submit", "Elaborate", "Cancel"] as const;
export const NO_PREVIEW_TEXT = "No preview available";
export const LAYMAN_REQUEST_NOTICE =
	"Layman explanation requested for this question";
export const UI_VARIATIONS_REQUEST_NOTICE =
	"UI variation mockups requested for this question";
export const LAYMAN_EXPLANATION_INSTRUCTION =
	"Explain every option and the differences between options for the requested questions in everyday language without unnecessary jargon. Use concrete inline examples in follow-up ask_user option descriptions or previews wherever applicable. First explain directly, then re-ask only these questions if a choice is still needed. If Elaborate was also selected, handle its separately noted clarification requests too. Preserve answers to other questions and do not ask them again. Previously saved choices for requested questions are not committed answers.";
export const UI_VARIATIONS_INSTRUCTION =
	"Render each requested question's options as side-by-side visual mockups in a temporary HTML page — one mockup per option, options only, no extra designs. Write it to a temp file and open it in the default browser. Prefer one combined page listing every requested question when the surfaces are small or simple; use separate temp files when there are many moving parts so each can be discussed on its own. Then re-ask only these questions if a choice is still needed. Preserve answers to other questions and do not ask them again. Previously saved choices for requested questions are not committed answers.";
export const ELABORATION_INSTRUCTION =
	"First answer the user's noted clarification directly and concisely using the provided question and option context. Do not treat these notes as final answers. Then re-ask only the affected questions if a choice is still needed afterward. Do not jump straight to a follow-up question unless the note is already resolved.";
export const CANCELLED_SUMMARY = "User cancelled the ask flow";
export const SUBMITTED_SUMMARY = "User submitted the ask flow";
export const ELABORATED_SUMMARY = "User asked for elaboration based on notes";
export const CANCELLED_RESULT_TEXT = "Cancelled";
export const SUBMITTED_RESULT_TEXT = "Submitted";
export const ELABORATED_RESULT_TEXT = "Elaboration requested";
