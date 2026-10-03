# Lockgate interface system

Registry references supply interaction patterns. Lockgate's tokens supply their appearance.
The implementation tokens live in `src/ui/base-foundation.css`.

| Before | After | Why |
| --- | --- | --- |
| Pill buttons beside square selectors | 8px radius for buttons, inputs, selectors, and navigation | Related actions share a silhouette |
| Independent panel corner sizes | 12px radius for panels, dialogs, popovers, and guide cards | Surfaces form one family |
| Header controls sized by their contents | Matching 42px height, borders, and padding | Network and wallet controls align |
| Mixed menu-row radii | 6px inset-item radius | Nested shapes fit their enclosing surface |
| Arbitrary transitions | 160ms surface entry with shared easing | Quiet, predictable feedback |

Fully rounded shapes identify status badges. Circles identify dots, progress steps, and
brand marks. Do not apply pill styling to action controls.

Keep the existing monochrome palette and Inter/Inter Tight typography. Preserve official
brand colors and proportions. Use the same focus outline and border color across controls.

Motion indicates pointer interactions: menu/dialog entry, drawer movement, and button press.
Keyboard entry is immediate. Reduced-motion preferences disable motion. Do not animate balances,
financial status, or capital movement to imply an event that has not occurred.

Playgrnd's [Filament](https://www.playgrnd.tools/filament/index.html) was inspected as a visual
reference. Its expressive thread fields were not added to the desk. No external animation
runtime or copied generator code is shipped.

Validate additions at 375px, 768px, and 1440px. The browser suite checks header geometry,
keyboard navigation, reduced motion, and route overflow.
