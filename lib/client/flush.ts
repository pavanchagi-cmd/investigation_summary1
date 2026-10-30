/** Lets the Approve and Export buttons flush the editor's pending autosave first. */
export const narrativeFlush: { current: () => Promise<void> } = { current: async () => {} };

/** Fired by the Disposition panel when the analyst picks or clears a disposition; the editor updates section 3. */
export const DISPOSITION_EVENT = "narrative-disposition";
