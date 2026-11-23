/** Bound the UI's wait for Pi abort; never destroy or replace a live session. */
export async function awaitAbortOrTimeout(abort: () => Promise<void>, timeoutMs = 10_000): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve().then(abort),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(
				`Pi Agent did not finish abort within ${timeoutMs}ms; session retained for recovery`,
				)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
