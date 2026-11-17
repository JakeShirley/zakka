export const mapWithConcurrency = async <Input, Output>(
  inputs: readonly Input[],
  limit: number,
  worker: (input: Input) => Promise<Output>,
): Promise<Output[]> => {
  const results: Output[] = new Array(inputs.length);
  const failures: unknown[] = [];
  let nextIndex = 0;

  // After the first failure, stop starting new work but let in-flight work settle before
  // rejecting, so callers never see a rejection while workers are still writing files.
  await Promise.all(
    Array.from({ length: Math.min(limit, inputs.length) }, async () => {
      while (failures.length === 0 && nextIndex < inputs.length) {
        const index = nextIndex;
        nextIndex += 1;

        try {
          results[index] = await worker(inputs[index] as Input);
        } catch (error) {
          failures.push(error);
        }
      }
    }),
  );

  if (failures.length > 0) {
    throw failures[0];
  }

  return results;
};

export const safeFileName = (value: string | null | undefined, fallback: string): string => {
  const cleaned = Array.from(value ?? "", (character) =>
    character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? "_" : character,
  )
    .join("")
    .trim()
    .slice(0, 180)
    // Windows cannot create names that end in a dot or space, and "." or ".." are not files at all.
    .replace(/[. ]+$/, "");

  return cleaned.length > 0 ? cleaned : fallback;
};
