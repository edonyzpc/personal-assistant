# Chat Timeline Identicon Tech Selection

## Goal

Add role identicons to the left of the `YOU` and `ASSISTANT` labels in the chat timeline with negligible runtime and bundle overhead, while leaving room for lightweight animation.

## Current UI Fit

- Timeline messages are rendered in `src/chat/chat-view.ts` through `createMessageElement()`.
- Role labels are centralized in `createRoleLabel()`, which currently creates `.message-role`, optional assistant/thinking loader elements, and `.pa-chat-role-text`.
- The lowest-risk insertion point is inside `.message-role`, before the existing loader/text content.
- Existing CSS already gates message enter animations and loader animations behind `prefers-reduced-motion`, so identicon animation should follow that same pattern.

## Options Reviewed

### Minidenticons

Source: https://www.npmjs.com/package/minidenticons

Pros:

- Purpose-built for pixel-grid SVG identicons.
- Zero runtime dependencies.
- Small package footprint.
- Offers a plain `minidenticon(seed, saturation, lightness, hashFn?)` function, so the plugin can avoid registering a global custom element.
- Deterministic output is enough for two stable role identities.
- Animation can be implemented with CSS on the wrapper or image element, so generation remains one-time and synchronous.

Cons:

- Visual vocabulary is intentionally limited: symmetric 5x5 pixel matrix, single foreground color, transparent background.
- No built-in animation API. Animation is a product/CSS layer concern.
- Last release is older, so treat it as stable/simple rather than actively evolving.

### DiceBear Identicon

Source: https://www.dicebear.com/styles/identicon/

Pros:

- Well-maintained avatar system with many styles and a documented Identicon style.
- Deterministic `seed` support and rich core options.
- Can generate SVG strings locally via JS packages.

Cons:

- More infrastructure than this feature needs: DiceBear requires the core package plus a style package or style definition.
- The HTTP API should not be used for this plugin UI because it introduces network dependency, latency, privacy/GDPR concerns, and offline failure modes.
- The local JS path adds more dependency and bundle surface than Minidenticons for only two role avatars.
- No meaningful built-in animation advantage for this use case; animation would still be CSS/UI-layer work.

## Recommendation

Use the Minidenticons shape approach, but keep the generator local instead of importing the package root.

Reason: the published package root exports the desired `minidenticon()` function, but also registers the included custom element as a module side effect. That side effect is avoidable for this plugin because the needed algorithm is a tiny deterministic 5x5 symmetric SVG generator.

Implementation shape:

1. Keep a small helper in `src/chat/role-identicons.ts` that generates role icon models. Append a random chat-view session seed only to the pixel shape seed, so shapes are stable within one open chat session and vary between sessions while role colors remain stable.
2. Do not import the `minidenticons` package root unless a side-effect-free import path becomes available.
3. Extend `createRoleLabel()` to accept a role or identicon option and insert an inline SVG before the role text so CSS can transition fill, transform, and opacity.
4. Keep the assistant loader as-is; when streaming, the role label can render identicon, loader, then text, or identicon, text, then loader depending on the desired visual order.
5. Add scoped CSS:
   - fixed 24px desktop dimensions with a slightly larger compact/mobile pane size,
   - `aria-hidden="true"` and empty `alt`,
   - no layout shift,
   - optional CSS-only pulse/ring for live assistant generation,
   - disabled motion/transition under `prefers-reduced-motion: reduce`.
6. Cover with focused `chat-view` tests asserting the user and assistant role labels include identicons, the live assistant loader still appears, and reduced-motion CSS disables identicon animation.

## Animation Direction

Do not animate SVG generation. Generate role identicon shapes from the role plus a chat-view session seed, render the current message label as inline SVG, and animate only CSS state changes on the surrounding element and SVG color:

- default/static state: no animation;
- new message: transition the role icon from a slightly lower-opacity translated state into rest;
- live assistant: transition the role color, opacity, and a small vertical transform on `.pa-chat-role-identicon-assistant` while `.llm-message[aria-busy="true"]`;
- reduced motion: no animation or transition.

This keeps the feature cheap in long histories because old messages are static DOM with no repeating animation.

## Non-Goals

- Do not use DiceBear HTTP API.
- Do not introduce remote image loading.
- Do not register the Minidenticons custom element as a side effect.
- Do not make the identicon seed user-editable in settings for the first pass.
- Do not animate every historical avatar continuously.
