import { createRoot, type Root } from 'react-dom/client';

import type { OperationsReviewModel } from '../../ai-services/operations/operations-review-model';
import { OperationsDiff } from './OperationsDiff';

export interface OperationsDiffMountOptions {
    model: OperationsReviewModel;
    mode: 'compact' | 'full' | 'request';
}

export interface OperationsDiffMountHandle {
    update(options: OperationsDiffMountOptions): void;
    unmount(): void;
}

export function mountOperationsDiff(
    container: HTMLElement,
    options: OperationsDiffMountOptions,
): OperationsDiffMountHandle {
    const root: Root = createRoot(container);
    root.render(<OperationsDiff {...options} />);
    return {
        update(nextOptions) {
            root.render(<OperationsDiff {...nextOptions} />);
        },
        unmount() {
            root.unmount();
        },
    };
}
