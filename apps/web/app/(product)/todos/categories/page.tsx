"use client";

import Link from "next/link";
import { FormEvent, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, CalendarDays, Check, CheckCircle2, ChevronRight, ChevronsDown, ChevronsUp, Circle, Clock3, Eye, EyeOff, GripVertical, Pencil, Plus, Repeat2, Tags } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { TodoCategoryDto, TodoDto } from "@/lib/types";
import { REPEAT_OPTIONS, TODO_CATEGORIES, toRepeatPreset } from "@/lib/todo-options";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Sheet } from "@/components/sheet";
import { TodoSectionNav } from "@/components/todo-section-nav";

const colors = [{ value: "aqua", label: "민트" }, { value: "blush", label: "핑크" }, { value: "butter", label: "옐로" }, { value: "lilac", label: "라일락" }];

type CategoryTodoFilter = "ALL" | "OPEN" | "DONE";

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function repeatLabel(rule?: string | null) {
  const preset = toRepeatPreset(rule);
  return REPEAT_OPTIONS.find((option) => option.value === preset)?.label ?? "반복";
}

function CategoryTodoSheet({ category, onClose }: { category: TodoCategoryDto; onClose: () => void }) {
  const [filter, setFilter] = useState<CategoryTodoFilter>("ALL");
  const todos = useQuery({
    queryKey: ["todo-category-todos", category.id],
    queryFn: () => apiFetch<TodoDto[]>(`/me/todo-categories/${category.id}/todos`),
  });
  const rows = todos.data ?? [];
  const openCount = rows.filter((todo) => !todo.completedAt).length;
  const doneCount = rows.length - openCount;
  const totalCount = todos.isLoading ? category.todoCount ?? 0 : rows.length;
  const filtered = rows.filter((todo) => filter === "ALL" || (filter === "DONE" ? Boolean(todo.completedAt) : !todo.completedAt));
  const filters: Array<{ value: CategoryTodoFilter; label: string; count: number }> = [
    { value: "ALL", label: "전체", count: rows.length },
    { value: "OPEN", label: "예정", count: openCount },
    { value: "DONE", label: "완료", count: doneCount },
  ];

  return (
    <Sheet title={`${category.name} TODO`} onClose={onClose}>
      <div className="category-todo-sheet">
        <section className={`category-todo-summary category-tone-${category.color}`} aria-label={`${category.name} 카테고리 요약`}>
          <span><Tags aria-hidden /></span>
          <div><small>{category.baseCategory} 기준</small><b>전체 {totalCount}개</b><p>{todos.isLoading ? "예정·완료 상태를 확인하고 있어요" : `예정 ${openCount}개 · 완료 ${doneCount}개`}</p></div>
        </section>
        <div className="category-todo-filters" aria-label="TODO 상태 필터">
          {filters.map((item) => <button type="button" key={item.value} className={filter === item.value ? "selected" : ""} aria-pressed={filter === item.value} disabled={todos.isLoading} onClick={() => setFilter(item.value)}>{item.label}<span>{todos.isLoading ? "…" : item.count}</span></button>)}
        </div>
        {todos.isLoading ? <ListSkeleton /> : todos.isError ? <ErrorState message={todos.error instanceof Error ? todos.error.message : "카테고리 TODO를 불러오지 못했어요."} onRetry={() => void todos.refetch()} /> : filtered.length === 0 ? <EmptyState title={filter === "ALL" ? "아직 담긴 TODO가 없어요" : `${filters.find((item) => item.value === filter)?.label} TODO가 없어요`} body={filter === "ALL" ? "TODO를 만들 때 이 카테고리를 선택하면 여기에 모여요." : "다른 상태를 선택해 목록을 확인해보세요."} /> : (
          <div className="category-todo-list">
            {filtered.map((todo) => {
              const date = new Date(todo.dueDate);
              const dateKey = localDateKey(todo.dueDate);
              return (
                <Link href={`/todos?date=${dateKey}`} onClick={onClose} key={todo.id} aria-label={`${todo.title}, ${todo.completedAt ? "완료" : "예정"}, 일정에서 보기`}>
                  <span className={todo.completedAt ? "done" : "open"}>{todo.completedAt ? <CheckCircle2 aria-hidden /> : <Circle aria-hidden />}</span>
                  <div><b>{todo.title}</b><small><CalendarDays aria-hidden />{date.toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" })}<Clock3 aria-hidden />{date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}{todo.repeatRule && <><Repeat2 aria-hidden />{repeatLabel(todo.repeatRule)}</>}</small></div>
                  <ChevronRight aria-hidden />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function CategoryEditor({ category, onClose, onSaved }: { category?: TodoCategoryDto | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [baseCategory, setBaseCategory] = useState(category?.baseCategory ?? "생활");
  const [color, setColor] = useState(category?.color ?? "lilac");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiFetch(category ? `/me/todo-categories/${category.id}` : "/me/todo-categories", { method: category ? "PATCH" : "POST", body: JSON.stringify({ name, baseCategory, color, icon: "tag" }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "카테고리를 저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet title={category ? "카테고리 편집" : "새 카테고리"} onClose={onClose}>
      <form className="composer-form category-editor" onSubmit={submit}>
        <label className="field"><span>카테고리 이름</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 헬스장" maxLength={30} required /><small>내 TODO에 표시되는 이름이에요.</small></label>
        <fieldset><legend>기준 카테고리</legend><p>탐색 필터와 추천에서는 이 기준으로 분류해요.</p><div className="base-category-options">{TODO_CATEGORIES.map((item) => <button type="button" className={baseCategory === item ? "selected" : ""} aria-pressed={baseCategory === item} onClick={() => setBaseCategory(item)} key={item}>{item}{baseCategory === item && <Check aria-hidden />}</button>)}</div></fieldset>
        <fieldset><legend>색상</legend><div className="category-color-options">{colors.map((item) => <button type="button" className={`category-swatch category-tone-${item.value} ${color === item.value ? "selected" : ""}`} aria-pressed={color === item.value} onClick={() => setColor(item.value)} key={item.value}><span />{item.label}{color === item.value && <Check aria-hidden />}</button>)}</div></fieldset>
        {error && <p className="form-error">{error}</p>}
        <button className="button full" disabled={saving}>{saving ? "저장 중…" : category ? "변경사항 저장" : "카테고리 만들기"}</button>
      </form>
    </Sheet>
  );
}

function CategoryOrderEditor({ categories, busy, onClose, onSave }: { categories: TodoCategoryDto[]; busy: boolean; onClose: () => void; onSave: (ids: string[]) => Promise<void> }) {
  const [ordered, setOrdered] = useState(categories);
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? "");
  const [draggingId, setDraggingId] = useState("");
  const [error, setError] = useState("");
  const selectedIndex = ordered.findIndex((item) => item.id === selectedId);

  const moveTo = (id: string, target: number) => {
    setOrdered((current) => {
      const source = current.findIndex((item) => item.id === id);
      const bounded = Math.max(0, Math.min(target, current.length - 1));
      if (source < 0 || source === bounded) return current;
      const next = [...current];
      const [moved] = next.splice(source, 1);
      next.splice(bounded, 0, moved);
      return next;
    });
  };
  const moveOver = (sourceId: string, targetId: string) => {
    setOrdered((current) => {
      const source = current.findIndex((item) => item.id === sourceId);
      const target = current.findIndex((item) => item.id === targetId);
      if (source < 0 || target < 0 || source === target) return current;
      const next = [...current];
      const [moved] = next.splice(source, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-category-id]");
    if (target?.dataset.categoryId && target.dataset.categoryId !== draggingId) moveOver(draggingId, target.dataset.categoryId);
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    const index = ordered.findIndex((item) => item.id === id);
    const target = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? ordered.length - 1 : index;
    if (target === index) return;
    event.preventDefault();
    moveTo(id, target);
  };
  const save = async () => {
    setError("");
    try {
      await onSave(ordered.map((item) => item.id));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "순서를 저장하지 못했어요.");
    }
  };

  return (
    <Sheet title="카테고리 순서 편집" onClose={onClose}>
      <div className="category-order-editor">
        <p>손잡이를 끌어 원하는 위치에 놓으세요. 키보드에서는 방향키와 Home·End를 사용할 수 있어요.</p>
        <div className="category-order-list" onPointerMove={handlePointerMove} onPointerUp={() => setDraggingId("")} onPointerCancel={() => setDraggingId("")}>
          {ordered.map((item, index) => (
            <article className={`${draggingId === item.id ? "dragging" : ""} ${selectedId === item.id ? "selected" : ""}`} data-category-id={item.id} key={item.id}>
              <button className="category-drag-handle" type="button" aria-label={`${item.name} 순서 이동. 현재 ${index + 1}번째`} onFocus={() => setSelectedId(item.id)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setSelectedId(item.id); setDraggingId(item.id); }} onKeyDown={(event) => handleKeyDown(event, item.id)}><GripVertical aria-hidden /></button>
              <span className={`category-manage-icon category-tone-${item.color}`}><Tags aria-hidden /></span>
              <button type="button" className="category-order-name" onClick={() => setSelectedId(item.id)}><b>{item.name}</b><small>{index + 1}번째 · TODO {item.todoCount ?? 0}개</small></button>
            </article>
          ))}
        </div>
        {selectedIndex >= 0 && <div className="category-order-jumps" aria-label={`${ordered[selectedIndex].name} 빠른 이동`}><button type="button" disabled={selectedIndex === 0} onClick={() => moveTo(selectedId, 0)}><ChevronsUp />맨 위</button><button type="button" disabled={selectedIndex === 0} onClick={() => moveTo(selectedId, selectedIndex - 1)}><ArrowUp />위</button><button type="button" disabled={selectedIndex === ordered.length - 1} onClick={() => moveTo(selectedId, selectedIndex + 1)}><ArrowDown />아래</button><button type="button" disabled={selectedIndex === ordered.length - 1} onClick={() => moveTo(selectedId, ordered.length - 1)}><ChevronsDown />맨 아래</button></div>}
        {error && <p className="form-error">{error}</p>}
        <button className="button full" disabled={busy} onClick={() => void save()}>{busy ? "저장 중…" : "이 순서로 저장"}</button>
      </div>
    </Sheet>
  );
}

export default function TodoCategoriesPage() {
  const { status } = useSession();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<"new" | TodoCategoryDto | null>(null);
  const [viewing, setViewing] = useState<TodoCategoryDto | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState("");
  const categories = useQuery({ queryKey: ["todo-categories", showArchived], queryFn: () => apiFetch<TodoCategoryDto[]>(`/me/todo-categories${showArchived ? "?archived=true" : ""}`), enabled: status === "authenticated" });
  const update = useMutation({ mutationFn: ({ id, archived }: { id: string; archived: boolean }) => apiFetch(`/me/todo-categories/${id}`, { method: "PATCH", body: JSON.stringify({ archived }) }), onSuccess: (_data, input) => { setNotice(input.archived ? "카테고리를 보관했어요. 기존 TODO는 그대로 유지돼요." : "카테고리를 다시 사용해요."); void queryClient.invalidateQueries({ queryKey: ["todo-categories"] }); }, onError: (error) => setNotice(error instanceof Error ? error.message : "카테고리를 변경하지 못했어요.") });
  const reorder = useMutation({ mutationFn: (ids: string[]) => apiFetch<TodoCategoryDto[]>("/me/todo-categories/reorder", { method: "PATCH", body: JSON.stringify({ ids }) }), onSuccess: () => { setNotice("카테고리 순서를 저장했어요."); void queryClient.invalidateQueries({ queryKey: ["todo-categories"] }); } });
  const saved = () => { setEditor(null); setNotice("카테고리를 저장했어요."); void queryClient.invalidateQueries({ queryKey: ["todo-categories"] }); };
  if (status === "loading") return <main className="app-page"><ListSkeleton /></main>;
  if (status === "guest") return <main className="app-page"><AuthGate title="카테고리는 로그인 후 관리할 수 있어요" /></main>;
  const active = (categories.data ?? []).filter((item) => !item.archivedAt);
  const archived = (categories.data ?? []).filter((item) => item.archivedAt);

  return (
    <main className="app-page todo-management-page">
      <header className="page-intro compact"><div><span>내 생활에 맞는 분류</span><h1>카테고리</h1></div></header>
      <TodoSectionNav />
      <section className="category-guide"><Tags aria-hidden /><div><b>이름은 나답게, 탐색 기준은 일관되게</b><p>직접 만든 이름도 공개 탐색에서는 8개 기준 중 하나로 연결돼요.</p></div></section>
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}
      {categories.isLoading ? <ListSkeleton /> : categories.isError ? <ErrorState onRetry={() => void categories.refetch()} /> : (
        <>
          <div className="category-page-actions"><button type="button" onClick={() => setOrdering(true)} disabled={active.length < 2}><GripVertical />순서 편집</button><span>{active.length}개 사용 중</span></div>
          <div className="category-gallery">
            <button type="button" className="category-create-card" onClick={() => setEditor("new")}><span><Plus aria-hidden /></span><b>새 카테고리</b><small>나만의 분류 만들기</small></button>
            {active.map((item) => (
              <article className={`category-gallery-card category-tone-${item.color}`} key={item.id}>
                <button type="button" className="category-card-open" onClick={() => setViewing(item)} aria-label={`${item.name} 카테고리 TODO 보기`}>
                  <header><span><Tags aria-hidden /></span><small>{item.isDefault ? "기본" : `${item.baseCategory} 기준`}</small></header>
                  <div><h2>{item.name}</h2><p>TODO {item.todoCount ?? 0}개</p></div>
                  <span className="category-card-hint">목록 보기 <ChevronRight aria-hidden /></span>
                </button>
                <footer>{!item.isDefault && <button type="button" onClick={() => setEditor(item)}><Pencil />편집</button>}<button type="button" onClick={() => update.mutate({ id: item.id, archived: true })}><EyeOff />숨김</button></footer>
              </article>
            ))}
          </div>
          {!active.length && <EmptyState title="사용 중인 카테고리가 없어요" body="보관한 카테고리를 다시 켜거나 새로 만들어보세요." />}
        </>
      )}
      <button className="archived-category-toggle" onClick={() => setShowArchived((value) => !value)} aria-expanded={showArchived}>{showArchived ? <Eye /> : <Archive />}보관된 카테고리 {showArchived ? "접기" : "보기"}</button>
      {showArchived && archived.length > 0 && <div className="category-manage-list archived">{archived.map((item) => <article key={item.id}><span className="category-manage-icon"><Archive /></span><div><b>{item.name}</b><small>{item.baseCategory} 기준 · 기존 TODO 유지</small></div><button className="category-restore" onClick={() => update.mutate({ id: item.id, archived: false })}>다시 사용</button></article>)}</div>}
      {viewing && <CategoryTodoSheet category={viewing} onClose={() => setViewing(null)} />}
      {editor && <CategoryEditor category={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={saved} />}
      {ordering && <CategoryOrderEditor categories={active} busy={reorder.isPending} onClose={() => setOrdering(false)} onSave={async (ids) => { await reorder.mutateAsync(ids); }} />}
    </main>
  );
}
