import { Button } from "@fluentui/react-components";
import { AddRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { apiClient } from "../../apiClient";
import { Panel, WorkspaceHeader } from "../../components/layout";
import { getErrorMessage } from "../../lib/errors";
import type { BookSummary } from "../../types";
import { ShutterflyImportModal } from "./ShutterflyImportModal";
import {
  commonBookPageSizes,
  defaultBookPageSize,
  formatBookPageSize,
  getBookPageSizeByKey,
} from "./pageSizes";

export function BooksView() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newBookPageSizeKey, setNewBookPageSizeKey] = useState<string>(defaultBookPageSize.key);
  const [error, setError] = useState<string | null>(null);
  const [isShutterflyImportOpen, setIsShutterflyImportOpen] = useState(false);

  const loadBooks = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      const bookResponse = await apiClient.listBooks();

      if (isCurrent()) {
        setBooks(bookResponse.books);
        setError(null);
      }
    } catch (loadError: unknown) {
      if (isCurrent()) {
        setError(getErrorMessage(loadError));
      }
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void loadBooks(() => isMounted);

    return () => {
      isMounted = false;
    };
  }, [loadBooks]);

  const createBook = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const pageSize = getBookPageSizeByKey(newBookPageSizeKey);
      const book = await apiClient.createBook({
        title: `Book ${books.length + 1}`,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
      });
      navigate(`/books/${book.id}`);
    } catch (createError: unknown) {
      setError(getErrorMessage(createError));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <WorkspaceHeader title="Books">
        <div className="book-create-controls">
          <label className="book-size-picker">
            <span>Page size</span>
            <select
              value={newBookPageSizeKey}
              onChange={(event) => setNewBookPageSizeKey(event.currentTarget.value)}
            >
              {commonBookPageSizes.map((pageSize) => (
                <option key={pageSize.key} value={pageSize.key}>
                  {pageSize.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="secondary-button"
            icon={<ArrowDownloadRegular />}
            type="button"
            onClick={() => setIsShutterflyImportOpen(true)}
          >
            Import from Shutterfly
          </Button>
          <Button
            appearance="primary"
            className="primary-button"
            disabled={isCreating}
            icon={<AddRegular />}
            type="button"
            onClick={createBook}
          >
            New book
          </Button>
        </div>
      </WorkspaceHeader>
      {isShutterflyImportOpen ? (
        <ShutterflyImportModal
          onClose={() => {
            setIsShutterflyImportOpen(false);
            // An import may have created a book even if the user closes without opening it.
            void loadBooks();
          }}
          onOpenBook={(bookId) => navigate(`/books/${bookId}`)}
        />
      ) : null}
      {error ? (
        <p className="panel-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="books-home-grid">
        <Panel title="Books" count={String(books.length)}>
          {isLoading ? <p className="empty-state">Loading books</p> : null}
          {!isLoading && books.length === 0 ? (
            <div className="books-empty-state">
              <p>No books yet.</p>
              <Button
                appearance="primary"
                type="button"
                className="primary-button"
                disabled={isCreating}
                icon={<AddRegular />}
                onClick={createBook}
              >
                Create your first book
              </Button>
            </div>
          ) : null}
          {books.length > 0 ? <BookList books={books} /> : null}
        </Panel>
      </div>
    </>
  );
}

function BookList({ books }: { books: BookSummary[] }) {
  const navigate = useNavigate();

  return (
    <ol className="book-card-list">
      {books.map((book) => (
        <li key={book.id}>
          <button type="button" onClick={() => navigate(`/books/${book.id}`)}>
            <span className="book-card-cover" aria-hidden="true">
              <span />
              <span />
            </span>
            <span className="book-card-copy">
              <span>{book.title}</span>
              <span>
                {book.pageCount} pages / {book.spreadCount} spreads / {formatBookPageSize(book)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
