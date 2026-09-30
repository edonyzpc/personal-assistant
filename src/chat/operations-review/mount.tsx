import { createRoot, type Root } from 'react-dom/client';

import type { OperationsReviewModel } from '../../ai-services/operations/operations-review-model';
import { OperationsDiff } from './OperationsDiff';

export function mountOperationsDiff(
    container: HTMLElement,
    options: { model: OperationsReviewModel; mode: 'compact' | 'full' },
): () => void {
    const root: Root = createRoot(container);
    root.render(<OperationsDiff {...options} />);
    return () => root.unmount();
}
