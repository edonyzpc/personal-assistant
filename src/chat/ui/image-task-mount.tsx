import { createRoot, type Root } from 'react-dom/client';
import {
    ImageTaskCard,
    ImageTaskErrorBoundary,
    type ImageTaskCardProps,
} from './ImageTaskCard';

export interface ImageTaskCardMountHandle {
    update(props: ImageTaskCardProps): void;
    unmount(): void;
}

export function mountImageTaskCard(
    container: HTMLElement,
    initialProps: ImageTaskCardProps,
): ImageTaskCardMountHandle {
    const root: Root = createRoot(container);
    let latestProps = initialProps;
    let visible = initialProps.store.getState().viewVisible;
    let mounted = true;

    const render = () => {
        if (!mounted || !visible) return;
        root.render(
            <ImageTaskErrorBoundary>
                <ImageTaskCard {...latestProps} />
            </ImageTaskErrorBoundary>,
        );
    };
    const unsubscribe = initialProps.store.subscribe(state => {
        const nextVisible = state.viewVisible;
        if (nextVisible === visible) return;
        visible = nextVisible;
        if (nextVisible) render();
    });

    if (visible) render();

    return {
        update(nextProps) {
            if (!mounted) return;
            latestProps = nextProps;
            visible = nextProps.store.getState().viewVisible;
            render();
        },
        unmount() {
            if (!mounted) return;
            mounted = false;
            unsubscribe();
            root.unmount();
            latestProps.store.getState().releaseTask(latestProps.task.taskId);
        },
    };
}
