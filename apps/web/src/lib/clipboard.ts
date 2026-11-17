const copyWithSelection = (value: string): boolean => {
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }
};

/**
 * Copies text to the clipboard. The async Clipboard API is undefined outside secure contexts
 * (e.g. LAN over HTTP) and can be denied by permissions, so fall back to a selection copy.
 */
export const copyToClipboard = async (value: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Fall back to the legacy selection-based copy below.
  }

  if (!copyWithSelection(value)) {
    throw new Error("Copying to the clipboard is not available.");
  }
};
