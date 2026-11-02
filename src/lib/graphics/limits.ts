// Single home for the image-save limit (pure, so both the service and the notice text use it).
/** Max image saves per user per rolling 24 h (counted from drafts.image_saved_at). */
export const IMAGE_SAVE_LIMIT_PER_DAY = 30;
export const IMAGE_WINDOW_MS = 24 * 60 * 60_000;
