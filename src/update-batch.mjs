export async function processUpdateBatch({ response, dispatch, saveCursor }) {
  const messages = response.msgs || [];
  const results = await Promise.allSettled(
    messages.map((message) => Promise.resolve().then(() => dispatch(message))),
  );
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length} update message task failed`,
    );
  }

  if (response.get_updates_buf) {
    await saveCursor(response.get_updates_buf);
  }
}
