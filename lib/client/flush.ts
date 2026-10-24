/** Lets the Approve and Export buttons flush the editor's pending autosave first. */
export const narrativeFlush: { current: () => Promise<void> } = { current: async () => {} };
