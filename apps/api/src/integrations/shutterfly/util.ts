export const mapWithConcurrency = async <Input, Output>(
  inputs: readonly Input[],
  limit: number,
  worker: (input: Input) => Promise<Output>,
): Promise<Output[]> => {
  const results: Output[] = new Array(inputs.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, inputs.length) }, async () => {
      while (nextIndex < inputs.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(inputs[index] as Input);
      }
    }),
  );

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
