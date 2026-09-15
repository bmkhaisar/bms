import { useCallback, useEffect, useRef, useState } from "react";

export function readDocumentId(): string | null {
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

/** Pure lifecycle state machine for deep link transitions. */
export interface DeepLinkState<T> {
  urlId: string | null;
  activeUrlDocumentId: string | null;
  activeMode: "idle" | "url_opened" | "manually_opened" | "new_document";
  activeDocId?: string | null;
}

export type DeepLinkAction<T> =
  | { type: "URL_CHANGED"; urlId: string | null; documents: T[] }
  | { type: "DOCUMENTS_UPDATED"; documents: T[] }
  | { type: "MANUAL_OPEN_NEW" }
  | { type: "MANUAL_OPEN_DOC"; documentId: string }
  | { type: "MANUAL_CLOSE" };

export interface DeepLinkTransitionResult<T> {
  nextState: DeepLinkState<T>;
  effect?: { type: "OPEN"; document: T } | { type: "CLOSE" };
}

export function handleDeepLinkTransition<T extends { id: string }>(
  state: DeepLinkState<T>,
  action: DeepLinkAction<T>
): DeepLinkTransitionResult<T> {
  switch (action.type) {
    case "URL_CHANGED": {
      const { urlId, documents } = action;
      if (!urlId) {
        // Only close if the active document was previously opened FROM THAT URL
        if (state.activeMode === "url_opened" && state.activeUrlDocumentId !== null) {
          return {
            nextState: {
              urlId: null,
              activeUrlDocumentId: null,
              activeMode: "idle",
              activeDocId: null,
            },
            effect: { type: "CLOSE" },
          };
        }
        // If it was manually opened or new document, requestedId === null must NEVER close it
        return {
          nextState: {
            ...state,
            urlId: null,
          },
        };
      }

      // urlId is present. Find matching document.
      const match = documents.find((doc) => doc.id === urlId);
      if (match && state.activeUrlDocumentId !== urlId) {
        return {
          nextState: {
            urlId,
            activeUrlDocumentId: urlId,
            activeMode: "url_opened",
            activeDocId: urlId,
          },
          effect: { type: "OPEN", document: match },
        };
      }

      return {
        nextState: {
          ...state,
          urlId,
        },
      };
    }

    case "DOCUMENTS_UPDATED": {
      const { documents } = action;
      // If there is an active requested URL ID that hasn't opened yet (e.g. initial load before documents arrived)
      if (state.urlId && state.activeUrlDocumentId !== state.urlId) {
        const match = documents.find((doc) => doc.id === state.urlId);
        if (match) {
          return {
            nextState: {
              ...state,
              activeUrlDocumentId: state.urlId,
              activeMode: "url_opened",
              activeDocId: state.urlId,
            },
            effect: { type: "OPEN", document: match },
          };
        }
      }
      // If urlId is null, DOCUMENTS_UPDATED must NEVER close a manually opened or new document
      return { nextState: state };
    }

    case "MANUAL_OPEN_NEW": {
      return {
        nextState: {
          ...state,
          activeMode: "new_document",
          activeDocId: null,
          activeUrlDocumentId: null,
        },
      };
    }

    case "MANUAL_OPEN_DOC": {
      return {
        nextState: {
          ...state,
          activeMode: "manually_opened",
          activeDocId: action.documentId,
          activeUrlDocumentId: null,
        },
      };
    }

    case "MANUAL_CLOSE": {
      return {
        nextState: {
          urlId: null,
          activeUrlDocumentId: null,
          activeMode: "idle",
          activeDocId: null,
        },
        effect: { type: "CLOSE" },
      };
    }
  }
}

/** One URL ↔ modal selection contract shared by document pages. */
export function useDocumentDeepLink<T extends { id: string }>(options: {
  documents: T[];
  onOpen: (document: T) => void;
  onClose: () => void;
}) {
  const [requestedId, setRequestedId] = useState<string | null>(readDocumentId);
  const activeUrlDocumentIdRef = useRef<string | null>(null);
  const openedIdRef = activeUrlDocumentIdRef;
  const isUrlOpenedRef = useRef<boolean>(false);
  const onOpenRef = useRef(options.onOpen);
  const onCloseRef = useRef(options.onClose);
  onOpenRef.current = options.onOpen;
  onCloseRef.current = options.onClose;

  useEffect(() => {
    const syncFromHistory = () => {
      const newId = readDocumentId();
      setRequestedId(newId);
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  useEffect(() => {
    if (!requestedId) {
      // requestedId === null must NEVER close a manually opened or new document editor.
      // Only close when the SAME active deep-linked document had previously been opened from that URL.
      if (isUrlOpenedRef.current && openedIdRef.current !== null) {
        isUrlOpenedRef.current = false;
        openedIdRef.current = null;
        onCloseRef.current();
      }
      return;
    }

    const match = options.documents.find((document) => document.id === requestedId);
    if (match && openedIdRef.current !== requestedId) {
      openedIdRef.current = requestedId;
      isUrlOpenedRef.current = true;
      onOpenRef.current(match);
    }
  }, [requestedId, options.documents]);

  const markManualOpen = useCallback((documentId?: string) => {
    isUrlOpenedRef.current = false;
    activeUrlDocumentIdRef.current = null;
    if (typeof window !== "undefined" && window.location.search.includes("id=")) {
      window.history.replaceState(window.history.state, "", withoutDocumentId(window.location.href));
      setRequestedId(null);
    }
  }, []);

  const closeDocument = useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", withoutDocumentId(window.location.href));
    }
    isUrlOpenedRef.current = false;
    activeUrlDocumentIdRef.current = null;
    setRequestedId(null);
    onCloseRef.current();
  }, []);

  return { requestedId, closeDocument, markManualOpen };
}
