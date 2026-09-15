import { useCallback, useEffect, useRef, useState } from "react";

function readDocumentId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("id");
}

export function documentDeepLink(path: "/invoices" | "/quotations", documentId: string): string {
  return `${path}?id=${encodeURIComponent(documentId)}`;
}

export function withoutDocumentId(href: string): string {
  const url = new URL(href, "http://local.invalid");
  url.searchParams.delete("id");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** One URL ↔ modal selection contract shared by document pages. */
export function useDocumentDeepLink<T extends { id: string }>(options: {
  documents: T[];
  onOpen: (document: T) => void;
  onClose: () => void;
}) {
  const [requestedId, setRequestedId] = useState<string | null>(readDocumentId);
  const openedIdRef = useRef<string | null>(null);
  const onOpenRef = useRef(options.onOpen);
  const onCloseRef = useRef(options.onClose);
  onOpenRef.current = options.onOpen;
  onCloseRef.current = options.onClose;

  useEffect(() => {
    const syncFromHistory = () => setRequestedId(readDocumentId());
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  useEffect(() => {
    if (!requestedId) {
      openedIdRef.current = null;
      onCloseRef.current();
      return;
    }
    const match = options.documents.find((document) => document.id === requestedId);
    if (match && openedIdRef.current !== requestedId) {
      openedIdRef.current = requestedId;
      onOpenRef.current(match);
    }
  }, [requestedId, options.documents]);

  const closeDocument = useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", withoutDocumentId(window.location.href));
    }
    openedIdRef.current = null;
    setRequestedId(null);
    onCloseRef.current();
  }, []);

  return { requestedId, closeDocument };
}
