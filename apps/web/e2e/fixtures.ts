import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  test as base,
} from "@playwright/test";

export { expect };

export type TestAccount = { displayName: string; email: string; password: string };

type BookResponse = {
  id: string;
  pages: Array<{ pageId: string; page: { title: string } }>;
  title: string;
};

type PageDocumentResponse = {
  document: {
    canvas: { backgroundColor: string; height: number; width: number };
    layers: Array<{ id: string; kind: string; text?: string; x: number; y: number }>;
  };
  title: string;
};

let accountCounter = 0;

/**
 * Every test gets its own freshly registered account, so tests never share data and can run in
 * parallel against the same API. Registration sets the session cookie on the page's context.
 */
export const test = base.extend<{ account: TestAccount }>({
  account: async ({ page }, use, testInfo) => {
    accountCounter += 1;
    const account = {
      displayName: "E2E Tester",
      email: `e2e-${testInfo.parallelIndex}-${Date.now()}-${accountCounter}@zakka.test`,
      password: "correct horse battery staple",
    };
    const response = await page.request.post("/api/v1/auth/register", { data: account });
    expect(response.ok(), await response.text()).toBe(true);

    await use(account);
  },
});

export async function createBook(request: APIRequestContext, title = "E2E book") {
  const response = await request.post("/api/v1/books", { data: { title } });
  expect(response.ok(), await response.text()).toBe(true);

  return (await response.json()) as BookResponse;
}

export async function getBook(request: APIRequestContext, bookId: string) {
  const response = await request.get(`/api/v1/books/${bookId}`);
  expect(response.ok()).toBe(true);

  return (await response.json()) as BookResponse;
}

export async function addBookPage(request: APIRequestContext, bookId: string, title: string) {
  const pageResponse = await request.post("/api/v1/pages", { data: { title } });
  expect(pageResponse.ok(), await pageResponse.text()).toBe(true);
  const created = (await pageResponse.json()) as { id: string };
  const book = await getBook(request, bookId);
  const pageIds = book.pages.map((bookPage) => bookPage.pageId);
  // Insert before the back cover so the page lands inside the book.
  pageIds.splice(Math.max(0, pageIds.length - 1), 0, created.id);
  const response = await request.put(`/api/v1/books/${bookId}/pages`, { data: { pageIds } });
  expect(response.ok(), await response.text()).toBe(true);

  return created.id;
}

export async function getSavedPage(request: APIRequestContext, pageId: string) {
  const response = await request.get(`/api/v1/pages/${pageId}`);
  expect(response.ok()).toBe(true);

  return (await response.json()) as PageDocumentResponse;
}

export async function openBook(page: Page, bookId: string) {
  await page.goto(`/books/${bookId}`);
  await expect(page.getByRole("region", { name: "Book editor" })).toBeVisible();
}

export const pageFrame = (page: Page, pageNumber: number): Locator =>
  page.getByRole("region", { name: `Page ${pageNumber}`, exact: true });

export const canvasLayers = (frame: Locator, kind?: string): Locator =>
  frame.locator(kind ? `.canvas-layer[data-kind="${kind}"]` : ".canvas-layer");

export const filmstripPage = (page: Page, title: string | RegExp): Locator =>
  page.getByRole("list", { name: "Book pages" }).getByRole("button", { name: title });
