import { Component, useEffect, useReducer, useRef, type MutableRefObject, type ReactNode } from 'react';
import { setIcon } from 'obsidian';
import { useStore } from 'zustand';
import type { ImageGenerationOutput, ImageGenerationTask } from '../image-generation-types';
import { CHAT_MENU_IDLE_CLOSE_MS, updateChatMenuAvailableWidth } from '../menu-helpers';
import { getPluginUiLanguage, pluginT } from '../../locales/plugin';
import type { ChatUiStore } from './chat-ui-store';

export interface ImageTaskMessageAction {
    id: string;
    label: string;
    icon: string;
    disabled?: boolean;
    danger?: boolean;
    run(this: void): void;
}

export interface ImageTaskCardActions {
    regenerate(this: void): void;
    stop(this: void): void;
    approveWhiteBackground(this: void): void;
    resume(this: void): void;
    preview(this: void, output: ImageGenerationOutput): void;
    edit(this: void, output: ImageGenerationOutput): void;
    download(this: void, output: ImageGenerationOutput, ownerDocument: Document | null): void;
    copy(this: void, output: ImageGenerationOutput, ownerDocument: Document | null): void;
    save(this: void, output: ImageGenerationOutput): void;
    resolvePreview(this: void, output: ImageGenerationOutput): Promise<{ url: string; release(this: void): void } | null>;
}

export interface ImageTaskCardProps {
    task: ImageGenerationTask;
    actions: ImageTaskCardActions;
    getMessageActions(this: void): ImageTaskMessageAction[];
    canDeliverOutputs: boolean;
    canSaveToNote: boolean;
    store: ChatUiStore;
}

interface PreviewResult {
    url: string;
    release(this: void): void;
}

const recoveryLabels: Record<string, string> = {
    ready_to_continue: 'readyToContinue',
    provider_acceptance_unknown: 'acceptanceUnknown',
    connection_changed: 'connectionChanged',
    connection_unavailable: 'connectionUnavailable',
    credential_unavailable: 'credentialUnavailable',
    provider_result_expired: 'resultExpired',
    source_changed: 'sourceChanged',
    source_changed_before_submit: 'sourceChanged',
    version_record_failed: 'versionRecordFailed',
    local_delivery_stopped: 'stoppedLocally',
    stopped_before_submit: 'stoppedBeforeSubmit',
    message_removed: 'messageRemoved',
    provider_rejected: 'providerRejected',
    provider_failed: 'providerFailed',
    save_failed: 'saveFailed',
    transparent_input_needs_confirmation: 'transparentInputNeedsConfirmation',
};

function imageTaskText(key: string, params?: Readonly<Record<string, string | number>>): string {
    return pluginT(key, getPluginUiLanguage(), params);
}

function recoveryText(reason: string): string {
    return pluginT(
        `plugin.chat.createImage.recovery.${recoveryLabels[reason] ?? 'other'}`,
        getPluginUiLanguage(),
    );
}

function ActionButton({
    className,
    icon,
    label,
    showLabel = false,
    disabled = false,
    onClick,
    buttonRef,
    expanded,
}: {
    className: string;
    icon: string;
    label: string;
    showLabel?: boolean;
    disabled?: boolean;
    onClick(this: void): void;
    buttonRef?: MutableRefObject<HTMLButtonElement | null>;
    expanded?: boolean;
}) {
    const iconRef = useRef<HTMLSpanElement | null>(null);
    useEffect(() => {
        if (iconRef.current) setIcon(iconRef.current, icon);
    }, [icon]);
    return (
        <button
            ref={node => {
                if (buttonRef) buttonRef.current = node;
            }}
            type="button"
            className={`message-action-button ${className}`}
            title={label}
            aria-label={label}
            aria-haspopup={expanded === undefined ? undefined : 'menu'}
            aria-expanded={expanded}
            disabled={disabled}
            onClick={onClick}
        >
            <span ref={iconRef} aria-hidden="true" />
            <span className="pa-sr-only">{label}</span>
            {showLabel ? <span>{label}</span> : null}
        </button>
    );
}

function MenuIcon({ icon }: { icon: string }) {
    const iconRef = useRef<HTMLSpanElement | null>(null);
    useEffect(() => {
        if (iconRef.current) setIcon(iconRef.current, icon);
    }, [icon]);
    return <span className="pa-chat-menu-item-icon" ref={iconRef} aria-hidden="true" />;
}

function TaskMenu({
    store,
    menuId,
    regenerate,
    getMessageActions,
}: {
    store: ChatUiStore;
    menuId: string;
    regenerate(this: void): void;
    getMessageActions(this: void): ImageTaskMessageAction[];
}) {
    const open = useStore(store, state => state.taskMenusOpen[menuId] ?? false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const messageActions = open ? getMessageActions() : [];

    useEffect(() => {
        return () => store.getState().setTaskMenuOpen(menuId, false);
    }, [menuId, store]);

    useEffect(() => {
        if (!open || !store.getState().viewVisible) return;
        const document = triggerRef.current?.ownerDocument ?? null;
        const menu = menuRef.current;
        const trigger = triggerRef.current;
        let timeout: number | undefined;
        const close = (focusTrigger = false) => {
            store.getState().setTaskMenuOpen(menuId, false);
            if (focusTrigger && store.getState().viewVisible) trigger?.focus({ preventScroll: true });
        };
        const refreshIdle = () => {
            if (timeout !== undefined) document?.defaultView?.clearTimeout(timeout);
            timeout = document?.defaultView?.setTimeout(() => close(), CHAT_MENU_IDLE_CLOSE_MS);
        };
        const onOutside = (event: Event): void => {
            if (menuRef.current?.contains(event.target as Node | null)) return;
            if (triggerRef.current?.contains(event.target as Node | null)) return;
            close();
        };
        const onTriggerKey = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close(true);
        };
        const menuButtons = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(
            'button.pa-chat-menu-item:not([disabled])',
        ) ?? []);
        const onMenuKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
                return;
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            const items = menuButtons();
            if (!items.length) return;
            const activeElement = (document?.activeElement ?? null) as HTMLButtonElement | null;
            const currentIndex = activeElement ? items.indexOf(activeElement) : -1;
            let nextIndex = event.key === 'Home' ? 0
                : event.key === 'End' ? items.length - 1
                    : currentIndex + (event.key === 'ArrowDown' ? 1 : -1);
            if (nextIndex < 0) nextIndex = items.length - 1;
            if (nextIndex >= items.length) nextIndex = 0;
            items[nextIndex]?.focus();
        };
        document?.addEventListener?.('pointerdown', onOutside, true);
        document?.addEventListener?.('click', onOutside, true);
        menu?.addEventListener('keydown', onMenuKey);
        trigger?.addEventListener('keydown', onTriggerKey);
        const idleEvents = ['mousemove', 'focusin', 'keydown', 'click'];
        for (const element of [menu, trigger]) {
            for (const eventName of idleEvents) element?.addEventListener(eventName, refreshIdle);
        }
        if (menu) updateChatMenuAvailableWidth(menu);
        menuButtons()[0]?.focus({ preventScroll: true });
        refreshIdle();
        return () => {
            if (timeout !== undefined) document?.defaultView?.clearTimeout?.(timeout);
            document?.removeEventListener?.('pointerdown', onOutside, true);
            document?.removeEventListener?.('click', onOutside, true);
            menu?.removeEventListener('keydown', onMenuKey);
            trigger?.removeEventListener('keydown', onTriggerKey);
            for (const element of [menu, trigger]) {
                for (const eventName of idleEvents) element?.removeEventListener(eventName, refreshIdle);
            }
        };
    }, [menuId, open, store]);

    return (
        <span className="pa-chat-popover-control pa-chat-image-task-card__more-control">
            <ActionButton
                className="pa-chat-image-task-card__more"
                icon="ellipsis"
                label={imageTaskText('plugin.chat.createImage.moreTaskActions')}
                buttonRef={triggerRef}
                expanded={open}
                onClick={() => {
                    if (store.getState().viewVisible) store.getState().setTaskMenuOpen(menuId, !open);
                }}
            />
            {open
                ? (
                    <div className="pa-chat-menu pa-chat-message-menu pa-chat-image-task-card__menu" role="menu" ref={menuRef}>
                        <button
                            type="button"
                            className="pa-chat-menu-item"
                            onClick={() => {
                                store.getState().setTaskMenuOpen(menuId, false);
                                regenerate();
                            }}
                        >
                            <MenuIcon icon="refresh-cw" />
                            <span className="pa-chat-menu-item-text">
                                {imageTaskText('plugin.chat.createImage.regenerate')}
                            </span>
                        </button>
                        {messageActions.length
                            ? (
                                <>
                                    <div className="pa-chat-menu-divider" />
                                    <div className="pa-chat-menu-label">
                                        <MenuIcon icon="message-square" />
                                        <span className="pa-chat-menu-label-text">
                                            {imageTaskText('plugin.chat.createImage.responseText')}
                                        </span>
                                    </div>
                                    {messageActions.map(action => (
                                        <button
                                            key={action.id}
                                            type="button"
                                            className={`pa-chat-menu-item${action.danger ? ' pa-chat-menu-item-danger' : ''}`}
                                            disabled={action.disabled}
                                            onClick={() => {
                                                store.getState().setTaskMenuOpen(menuId, false);
                                                action.run();
                                            }}
                                        >
                                            <MenuIcon icon={action.icon} />
                                            <span className="pa-chat-menu-item-text">{action.label}</span>
                                        </button>
                                    ))}
                                </>
                            )
                            : null}
                    </div>
                )
                : null}
        </span>
    );
}

function usePreviewUrl(
    output: ImageGenerationOutput,
    canDeliver: boolean,
    resolvePreview: (output: ImageGenerationOutput) => Promise<PreviewResult | null>,
): string | null {
    const [url, setUrl] = useReducer((current: string | null, next: string | null) => next, null);
    const resolverRef = useRef(resolvePreview);
    resolverRef.current = resolvePreview;
    const outputRef = useRef(output);
    outputRef.current = output;
    const assetId = output.assetRef?.assetId;
    const contentHash = output.assetRef?.contentHash;
    useEffect(() => {
        if (!canDeliver || output.saveState !== 'saved' || !assetId || !contentHash) {
            setUrl(null);
            return;
        }
        let current = true;
        let release: (() => void) | undefined;
        setUrl(null);
        void resolverRef.current(outputRef.current).then(result => {
            if (!result) return;
            if (!current) {
                result.release();
                return;
            }
            release = result.release;
            setUrl(result.url);
        }).catch(() => {
            if (current) setUrl(null);
        });
        return () => {
            current = false;
            release?.();
            release = undefined;
        };
    }, [assetId, canDeliver, contentHash, output.outputId, output.saveState]);
    return url;
}

function ImageOutput({
    task,
    output,
    actions,
    store,
    getMessageActions,
    canDeliverOutputs,
    canSaveToNote,
}: {
    task: ImageGenerationTask;
    output: ImageGenerationOutput;
    actions: ImageTaskCardActions;
    store: ChatUiStore;
    getMessageActions(this: void): ImageTaskMessageAction[];
    canDeliverOutputs: boolean;
    canSaveToNote: boolean;
}) {
    const ownerDocumentRef = useRef<HTMLDivElement | null>(null);
    const previewUrl = usePreviewUrl(output, canDeliverOutputs, actions.resolvePreview);
    if (output.saveState !== 'saved' || !output.assetRef) {
        return (
            <div className="pa-chat-image-task-card__output" key={output.outputId}>
                <div className="pa-chat-image-task-card__output-state">
                    {imageTaskText('plugin.chat.createImage.output', {
                        number: output.providerOrdinal + 1,
                        state: imageTaskText(`plugin.chat.createImage.outputState.${output.saveState}`),
                    })}
                </div>
                {output.recoveryReason ? <div>{recoveryText(output.recoveryReason)}</div> : null}
            </div>
        );
    }

    return (
        <div className="pa-chat-image-task-card__output" key={output.outputId} ref={ownerDocumentRef}>
            <div className="pa-chat-image-task-card__image-frame">
                <button
                    type="button"
                    className="message-action-button pa-chat-image-task-card__preview"
                    title={imageTaskText('plugin.chat.createImage.view')}
                    aria-label={imageTaskText('plugin.chat.createImage.viewNumber', {
                        number: output.providerOrdinal + 1,
                    })}
                    onClick={() => actions.preview(output)}
                >
                    <img
                        src={previewUrl ?? undefined}
                        alt={imageTaskText('plugin.chat.createImage.viewNumber', {
                            number: output.providerOrdinal + 1,
                        })}
                        hidden={!previewUrl}
                    />
                </button>
            </div>
            <div className="pa-chat-image-task-card__output-actions">
                <ActionButton
                    className="pa-chat-image-task-card__output-action pa-chat-image-task-card__output-action--edit"
                    icon="pencil"
                    label={imageTaskText('plugin.chat.createImage.editThis')}
                    onClick={() => actions.edit(output)}
                />
                <ActionButton
                    className="pa-chat-image-task-card__output-action pa-chat-image-task-card__output-action--download"
                    icon="download"
                    label={imageTaskText('plugin.chat.createImage.download')}
                    onClick={() => actions.download(output, ownerDocumentRef.current?.ownerDocument ?? null)}
                />
                <ActionButton
                    className="pa-chat-image-task-card__output-action"
                    icon="copy"
                    label={imageTaskText('plugin.chat.createImage.copy')}
                    onClick={() => actions.copy(output, ownerDocumentRef.current?.ownerDocument ?? null)}
                />
                {canSaveToNote ? (
                    <ActionButton
                        className="pa-chat-image-task-card__output-action"
                        icon="file-plus"
                        label={imageTaskText('plugin.chat.createImage.saveToNote')}
                        onClick={() => actions.save(output)}
                    />
                ) : null}
                <TaskMenu
                    store={store}
                    menuId={`${task.taskId}:${output.outputId}`}
                    regenerate={actions.regenerate}
                    getMessageActions={getMessageActions}
                />
            </div>
        </div>
    );
}

function ImageTaskCard(props: ImageTaskCardProps): ReactNode {
    const { task, actions, getMessageActions, canDeliverOutputs, canSaveToNote } = props;
    const store = props.store;
    const detailsOpen = useStore(store, state => state.taskDetailsOpen[task.taskId] ?? false);

    const hasSavedOutputs = canDeliverOutputs
        && task.outputs.some(output => output.saveState === 'saved' && output.assetRef);
    const needsStopAction = ['prepared', 'submitting', 'running', 'saving', 'partial'].includes(task.state)
        || (task.state === 'not_submitted' && task.recoveryReason === 'transparent_input_needs_confirmation');
    const needsWhiteBackgroundAction = task.recoveryReason === 'transparent_input_needs_confirmation'
        && ['prepared', 'not_submitted'].includes(task.state);
    const needsResumeAction = ['not_submitted', 'partial', 'running', 'saving'].includes(task.state)
        && task.recoveryReason !== 'transparent_input_needs_confirmation';

    return (
        <article
            className="pa-chat-image-task-card"
            data-created-at={task.createdAt}
            data-task-id={task.taskId}
            data-state={task.state}
        >
            <header className="pa-chat-image-task-card__header">
                <span className="pa-chat-image-task-card__header-text">
                    <span className="pa-chat-image-task-card__title">
                        {imageTaskText('plugin.chat.createImage.title')}
                    </span>
                    <span className="pa-chat-image-task-card__state" role="status" aria-live="polite">
                        {imageTaskText(`plugin.chat.createImage.state.${task.state}`)}
                    </span>
                </span>
                <span className="pa-chat-image-task-card__header-controls">
                    {hasSavedOutputs ? null : (
                        <TaskMenu
                            store={store}
                            menuId={`${task.taskId}:header`}
                            regenerate={actions.regenerate}
                            getMessageActions={getMessageActions}
                        />
                    )}
                </span>
            </header>
            {task.recoveryReason ? (
                <div className="pa-chat-image-task-card__recovery">{recoveryText(task.recoveryReason)}</div>
            ) : null}
            {task.inputWhiteBackgroundApplied ? (
                <div className="pa-chat-image-task-card__recovery">
                    {imageTaskText('plugin.chat.createImage.whiteBackgroundApplied')}
                </div>
            ) : null}
            <div className="pa-chat-image-task-card__outputs" hidden={task.outputs.length === 0 || !canDeliverOutputs}>
                {(canDeliverOutputs ? task.outputs : []).map(output => (
                    <ImageOutput
                        key={output.outputId}
                        task={task}
                        output={output}
                        actions={actions}
                        store={store}
                        getMessageActions={getMessageActions}
                        canDeliverOutputs={canDeliverOutputs}
                        canSaveToNote={canSaveToNote}
                    />
                ))}
            </div>
            {needsStopAction || needsWhiteBackgroundAction || needsResumeAction ? (
                <div className="pa-chat-image-task-card__actions">
                    {needsStopAction ? (
                        <ActionButton
                            className="pa-chat-image-task-card__action"
                            icon="square"
                            label={imageTaskText('plugin.chat.createImage.stop')}
                            showLabel
                            onClick={actions.stop}
                        />
                    ) : null}
                    {needsWhiteBackgroundAction ? (
                        <ActionButton
                            className="pa-chat-image-task-card__action"
                            icon="check"
                            label={imageTaskText('plugin.chat.createImage.approveWhiteBackground')}
                            showLabel
                            onClick={actions.approveWhiteBackground}
                        />
                    ) : null}
                    {needsResumeAction ? (
                        <ActionButton
                            className="pa-chat-image-task-card__action"
                            icon="rotate-cw"
                            label={imageTaskText(task.state === 'not_submitted'
                                ? 'plugin.chat.createImage.continue'
                                : 'plugin.chat.createImage.recover')}
                            showLabel
                            onClick={actions.resume}
                        />
                    ) : null}
                </div>
            ) : null}
            <details
                className="pa-chat-image-task-card__details"
                open={detailsOpen}
                onToggle={event => store.getState().setTaskDetailsOpen(
                    task.taskId,
                    (event.currentTarget as HTMLDetailsElement).open,
                )}
            >
                <summary>{imageTaskText('plugin.chat.createImage.details')}</summary>
                <div className="pa-chat-image-task-card__detail-field">
                    <span className="pa-chat-image-task-card__detail-label">
                        {imageTaskText(task.request.promptOrigin?.defaultUserPrompt
                            ? 'plugin.chat.createImage.detail.defaultOriginalRequest'
                            : 'plugin.chat.createImage.detail.originalRequest')}
                    </span>
                    <span className="pa-chat-image-task-card__detail-value">{task.request.userPrompt}</span>
                </div>
                {canDeliverOutputs ? (
                    <div className="pa-chat-image-task-card__detail-field">
                        <span className="pa-chat-image-task-card__detail-label">
                            {imageTaskText('plugin.chat.createImage.detail.submittedRequest')}
                        </span>
                        <span className="pa-chat-image-task-card__detail-value">{task.request.submittedPrompt}</span>
                    </div>
                ) : null}
                {task.request.promptOrigin ? (
                    <div className="pa-chat-image-task-card__detail-field">
                        <span className="pa-chat-image-task-card__detail-label">
                            {imageTaskText('plugin.chat.createImage.detail.source')}
                        </span>
                        <span className="pa-chat-image-task-card__detail-value">
                            {imageTaskText('plugin.chat.createImage.source.detail', {
                                kind: imageTaskText(task.request.promptOrigin.kind === 'selection'
                                    ? 'plugin.chat.createImage.source.selectionKind'
                                    : 'plugin.chat.createImage.source.noteKind'),
                                source: task.request.promptOrigin.displayName,
                                path: task.request.promptOrigin.path,
                            })}
                        </span>
                    </div>
                ) : null}
                <div className="pa-chat-image-task-card__detail-field">
                    <span className="pa-chat-image-task-card__detail-label">
                        {imageTaskText('plugin.chat.createImage.detail.model')}
                    </span>
                    <span className="pa-chat-image-task-card__detail-value">{task.request.model}</span>
                </div>
                <div className="pa-chat-image-task-card__detail-field">
                    <span className="pa-chat-image-task-card__detail-label">
                        {imageTaskText('plugin.chat.createImage.detail.count')}
                    </span>
                    <span className="pa-chat-image-task-card__detail-value">{String(task.request.count)}</span>
                </div>
                {task.request.size ? (
                    <div className="pa-chat-image-task-card__detail-field">
                        <span className="pa-chat-image-task-card__detail-label">
                            {imageTaskText('plugin.chat.createImage.detail.size')}
                        </span>
                        <span className="pa-chat-image-task-card__detail-value">{task.request.size}</span>
                    </div>
                ) : null}
                <div className="pa-chat-image-task-card__detail-field">
                    <span className="pa-chat-image-task-card__detail-label">
                        {imageTaskText('plugin.chat.createImage.detail.createdAt')}
                    </span>
                    <span className="pa-chat-image-task-card__detail-value">{task.createdAt}</span>
                </div>
                {task.request.inputRefs.length ? (
                    <div className="pa-chat-image-task-card__detail-field">
                        <span className="pa-chat-image-task-card__detail-label">
                            {imageTaskText('plugin.chat.createImage.detail.inputCount')}
                        </span>
                        <span className="pa-chat-image-task-card__detail-value">
                            {imageTaskText('plugin.chat.createImage.inputCount', {
                                count: task.request.inputRefs.length,
                            })}
                        </span>
                    </div>
                ) : null}
                {task.request.parentVersionId ? (
                    <div className="pa-chat-image-task-card__detail-field">
                        <span className="pa-chat-image-task-card__detail-label">
                            {imageTaskText('plugin.chat.createImage.detail.parentVersion')}
                        </span>
                        <span className="pa-chat-image-task-card__detail-value">
                            {imageTaskText('plugin.chat.createImage.parentVersion', {
                                version: task.request.parentVersionId,
                            })}
                        </span>
                    </div>
                ) : null}
            </details>
        </article>
    );
}

interface ImageTaskErrorBoundaryState {
    error: Error | null;
}

class ImageTaskErrorBoundary extends Component<
    { children: ReactNode },
    ImageTaskErrorBoundaryState
> {
    state: ImageTaskErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ImageTaskErrorBoundaryState {
        return { error };
    }

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        return (
            <div className="pa-chat-image-task-card pa-chat-image-task-card--error" role="alert">
                <div className="pa-chat-image-task-card__recovery">
                    {imageTaskText('plugin.chat.createImage.renderFailed')}
                </div>
                <button
                    type="button"
                    className="message-action-button pa-chat-image-task-card__action"
                    onClick={() => this.setState({ error: null })}
                >
                    <span>{imageTaskText('plugin.chat.createImage.retryRender')}</span>
                </button>
            </div>
        );
    }
}

export { ImageTaskCard, ImageTaskErrorBoundary };
