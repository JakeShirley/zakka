import { useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { RichTextEditor } from "./RichTextEditor";

async function renderEditor(initialValue: string) {
  const probe = { value: initialValue };

  function Harness() {
    const [value, setValue] = useState(initialValue);
    probe.value = value;

    return (
      <RichTextEditor
        ariaLabel="Text"
        value={value}
        onChange={(next) => {
          probe.value = next;
          setValue(next);
        }}
      />
    );
  }

  await render(<Harness />);
  const editor = page.getByRole("textbox", { name: "Text" });

  return { editor, probe };
}

function selectSourceRange(editor: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let node = walker.nextNode();

  while (node) {
    const length = node.textContent?.length ?? 0;
    if (start >= offset && start <= offset + length) range.setStart(node, start - offset);
    if (end >= offset && end <= offset + length) {
      range.setEnd(node, end - offset);
      break;
    }
    offset += length;
    node = walker.nextNode();
  }

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

test.each([
  ["Control", "b", "Hello **world**"],
  ["Meta", "b", "Hello **world**"],
  ["Control", "i", "Hello *world*"],
])("%s+%s wraps the selected word in visible markdown markers", async (modifier, key, expected) => {
  const { editor, probe } = await renderEditor("Hello world");

  await editor.click();
  selectSourceRange(editor.element() as HTMLElement, 6, 11);
  await userEvent.keyboard(`{${modifier}>}${key}{/${modifier}}`);

  expect(probe.value).toBe(expected);
  // The markers stay in the editable text rather than being hidden (#63).
  expect(editor.element().textContent).toBe(expected);
});

test("text between bold markers is styled live while the markers stay editable", async () => {
  const { editor } = await renderEditor("A **bold** idea");

  const bold = editor.element().querySelector(".rich-text-bold:not(.rich-text-marker)");
  const markers = editor.element().querySelectorAll(".rich-text-marker");

  expect(bold?.textContent).toBe("bold");
  expect(getComputedStyle(bold as Element).fontWeight).toBe("700");
  expect([...markers].map((marker) => marker.textContent)).toEqual(["**", "**"]);
});

test("deleting a marker immediately drops the styling", async () => {
  const { editor, probe } = await renderEditor("**bold**");

  await editor.click();
  selectSourceRange(editor.element() as HTMLElement, 8, 8);
  await userEvent.keyboard("{Backspace}");

  expect(probe.value).toBe("**bold*");
  expect(editor.element().querySelector(".rich-text-bold")).toBeNull();
});

test("pasting rich content inserts only its plain text at the caret", async () => {
  const { editor, probe } = await renderEditor("Hello ");

  await editor.click();
  selectSourceRange(editor.element() as HTMLElement, 6, 6);
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", "plain words");
  clipboardData.setData("text/html", "<b>plain</b> <i>words</i>");
  editor
    .element()
    .dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));

  expect(probe.value).toBe("Hello plain words");
  expect(editor.element().querySelector("b, i")).toBeNull();
});

test("Enter inserts a new line in the text", async () => {
  const { editor, probe } = await renderEditor("one");

  await editor.click();
  selectSourceRange(editor.element() as HTMLElement, 3, 3);
  await userEvent.keyboard("{Enter}two");

  expect(probe.value).toBe("one\ntwo");
});
