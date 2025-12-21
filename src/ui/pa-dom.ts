export type PaChatShell = {
	root: HTMLElement;
	scroll: HTMLDivElement;
	input: HTMLDivElement;
	textarea: HTMLTextAreaElement;
	buttonRow: HTMLDivElement;
	sendButton: HTMLButtonElement;
	clearButton: HTMLButtonElement;
	addButton: HTMLButtonElement;
	cancelButton: HTMLButtonElement;
};

export type PaChatMessage = {
	root: HTMLDivElement;
	content: HTMLDivElement;
	actions: HTMLDivElement;
	copyButton: HTMLButtonElement;
	deleteButton?: HTMLButtonElement;
};

type ClassValue = string | string[] | undefined;

const normalizeClasses = (value: ClassValue): string[] => {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
};

const createDiv = (parent: HTMLElement, cls?: ClassValue, text?: string) => {
	return parent.createDiv({ cls: normalizeClasses(cls), text });
};

const createButton = (parent: HTMLElement, text: string, cls?: ClassValue) => {
	return parent.createEl("button", { text, cls: normalizeClasses(cls) });
};

const createIconButton = (parent: HTMLElement, label: string, cls?: ClassValue) => {
	return parent.createEl("button", {
		cls: normalizeClasses(["pa-icon-button"].concat(normalizeClasses(cls))),
		attr: { "aria-label": label },
	});
};

export const buildChatShell = (containerEl: HTMLElement): PaChatShell => {
	containerEl.empty();
	containerEl.classList.add("pa-ui", "pa-chat");

	const scroll = createDiv(containerEl, "pa-chat__scroll");
	const input = createDiv(containerEl, "pa-chat__input");
	const textarea = input.createEl("textarea", {
		cls: "pa-textarea",
		attr: { rows: "4", placeholder: "Type your message here..." },
	});
	const buttonRow = createDiv(input, "pa-button-row");
	const sendButton = createButton(buttonRow, "Ask", ["pa-button", "pa-button--primary"]);
	const clearButton = createButton(buttonRow, "Clear Chat", "pa-button");
	const addButton = createButton(buttonRow, "Add to Editor", "pa-button");
	const cancelButton = createButton(buttonRow, "x", [
		"pa-button",
		"pa-button--icon",
		"pa-button--ghost",
		"pa-chat__cancel",
		"pa-is-hidden",
	]);

	return {
		root: containerEl,
		scroll,
		input,
		textarea,
		buttonRow,
		sendButton,
		clearButton,
		addButton,
		cancelButton,
	};
};

export const createChatMessage = (
	container: HTMLElement,
	role: "user" | "assistant",
	options?: { showDelete?: boolean; roleLabel?: string }
): PaChatMessage => {
	const root = createDiv(container, ["pa-chat__message", `pa-chat__message--${role}`]);
	root.dataset.role = role;
	createDiv(root, "pa-chat__role", options?.roleLabel ?? (role === "user" ? "You" : "Assistant"));
	const content = createDiv(root, "pa-chat__content");
	const actions = createDiv(root, "pa-chat__actions");
	const copyButton = createIconButton(actions, "Copy message");

	let deleteButton: HTMLButtonElement | undefined;
	if (options?.showDelete) {
		deleteButton = createIconButton(actions, "Delete message");
	}

	return { root, content, actions, copyButton, deleteButton };
};

export const buildPaNoticeContent = (
	title: string,
	options?: {
		showSpinner?: boolean;
		spinnerVariant?: "dots" | "bar";
		spinnerTone?: "blue" | "red";
		withBody?: boolean;
	}
) => {
	const fragment = document.createDocumentFragment();
	const wrapper = document.createElement("div");
	wrapper.className = "pa-notice";

	const header = document.createElement("div");
	header.className = "pa-notice__header";

	if (options?.showSpinner) {
		const spinner = document.createElement("div");
		const variant = options.spinnerVariant ?? "dots";
		const tone = options.spinnerTone ?? "blue";
		spinner.className = `pa-notice__spinner pa-spinner--${variant} pa-spinner--${tone}`;
		const dot = document.createElement("span");
		spinner.appendChild(dot);
		header.appendChild(spinner);
	}

	const text = document.createElement("span");
	text.className = "pa-notice__text";
	text.textContent = title;
	header.appendChild(text);

	wrapper.appendChild(header);
	if (options?.withBody) {
		const body = document.createElement("div");
		body.className = "pa-notice__body";
		wrapper.appendChild(body);
	}
	fragment.appendChild(wrapper);
	return fragment;
};

export const applyPaNoticeShell = (noticeEl: HTMLElement) => {
	noticeEl.classList.add("pa-notice-shell");
	noticeEl.parentElement?.classList.add("pa-notice-shell");
};
