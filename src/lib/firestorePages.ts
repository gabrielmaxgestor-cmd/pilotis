import {
  documentId, getDocsFromServer, limit, onSnapshot, orderBy, query, startAfter,
  type DocumentData, type FirestoreError, type Query, type QueryDocumentSnapshot, type Unsubscribe,
} from 'firebase/firestore';

export const FIRESTORE_PAGE_SIZE = 200;

type Row = QueryDocumentSnapshot<DocumentData>;

export async function readAllPages(source: Query<DocumentData>): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: Row | undefined;
  for (;;) {
    const page = await getDocsFromServer(query(source, orderBy(documentId()), limit(FIRESTORE_PAGE_SIZE),
      ...(cursor ? [startAfter(cursor)] : [])));
    rows.push(...page.docs);
    if (page.size < FIRESTORE_PAGE_SIZE) return rows;
    cursor = page.docs[page.docs.length - 1];
  }
}

type Page = { rows: Row[]; ready: boolean; after?: string; next?: Page; stop: Unsubscribe };

export function listenToPages(source: Query<DocumentData>, publish: (rows: Row[]) => void, onError: (error: FirestoreError) => void) {
  let root: Page;
  let stopped = false;

  function emit() {
    if (stopped || !root) return;
    const result = new Map<string, Row>();
    for (let page: Page | undefined = root; page; page = page.next) {
      if (!page.ready) return;
      for (const row of page.rows) result.set(row.id, row);
    }
    publish([...result.values()]);
  }

  function watch(cursor?: Row): Page {
    let live = true;
    const page: Page = { rows: [], ready: false, stop: () => undefined };
    // One extra document tells us whether to subscribe to a following page.
    const unsubscribe = onSnapshot(query(source, orderBy(documentId()), limit(FIRESTORE_PAGE_SIZE + 1),
      ...(cursor ? [startAfter(cursor)] : [])), (snapshot) => {
      if (!live || stopped) return;
      const rows = snapshot.docs.slice(0, FIRESTORE_PAGE_SIZE);
      const nextCursor = snapshot.size > rows.length ? rows[rows.length - 1] : undefined;
      page.rows = rows;
      page.ready = true;
      if (page.after !== nextCursor?.id) {
        page.next?.stop();
        page.after = nextCursor?.id;
        page.next = nextCursor ? watch(nextCursor) : undefined;
      }
      emit();
    }, onError);
    page.stop = () => {
      live = false;
      unsubscribe();
      page.next?.stop();
    };
    return page;
  }

  root = watch();
  return () => {
    stopped = true;
    root.stop();
  };
}
