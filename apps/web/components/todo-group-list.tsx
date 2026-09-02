"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Layers3, Settings2 } from "lucide-react";
import type { TodoDto, TodoListDto } from "@/lib/types";

interface TodoGroupView {
  list: TodoListDto;
  todos: TodoDto[];
}

function groupTodos(todos: TodoDto[], lists: TodoListDto[]) {
  const assigned = new Set<string>();
  const groups: TodoGroupView[] = [];

  for (const list of lists) {
    const orderedItems = [...list.items].sort((left, right) => left.order - right.order);
    const members = todos
      .map((todo) => {
        const order = orderedItems.findIndex(({ todo: listed }) => listed.id === todo.id || Boolean(todo.seriesId && listed.seriesId === todo.seriesId));
        return { todo, order };
      })
      .filter(({ todo, order }) => order >= 0 && !assigned.has(todo.id))
      .sort((left, right) => left.order - right.order)
      .map(({ todo }) => todo);

    if (!members.length) continue;
    members.forEach((todo) => assigned.add(todo.id));
    groups.push({ list, todos: members });
  }

  return { groups, ungrouped: todos.filter((todo) => !assigned.has(todo.id)) };
}

export function TodoGroupList({
  todos,
  lists,
  hiddenTodoIds,
  renderTodo,
  onEditGroup,
}: {
  todos: TodoDto[];
  lists: TodoListDto[];
  hiddenTodoIds?: ReadonlySet<string>;
  renderTodo: (todo: TodoDto) => ReactNode;
  onEditGroup?: (list: TodoListDto) => void;
}) {
  const { groups, ungrouped } = useMemo(() => groupTodos(todos, lists), [todos, lists]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const visibleUngrouped = ungrouped.filter((todo) => !hiddenTodoIds?.has(todo.id));

  const toggle = (id: string) => setExpanded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return (
    <div className="todo-group-list">
      {groups.map(({ list, todos: members }) => {
        const visibleMembers = members.filter((todo) => !hiddenTodoIds?.has(todo.id));
        if (!visibleMembers.length) return null;
        const isExpanded = expanded.includes(list.id);
        const completed = members.filter((todo) => todo.completedAt).length;
        const next = members.find((todo) => !todo.completedAt);
        const progress = Math.round((completed / members.length) * 100);
        return (
          <section className={`todo-thread ${isExpanded ? "expanded" : ""}`} key={list.id}>
            <div className="todo-thread-head">
              <button type="button" className="todo-thread-toggle" aria-expanded={isExpanded} onClick={() => toggle(list.id)}>
                <span className="todo-thread-icon"><Layers3 aria-hidden /></span>
                <span className="todo-thread-copy">
                  <b>{list.title}</b>
                  <small>{completed}/{members.length} 완료 · {next ? `다음 ${next.title}` : "모두 완료"}</small>
                </span>
                <span className="todo-thread-progress" aria-label={`${progress}% 완료`}><i style={{ width: `${progress}%` }} /></span>
                {isExpanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
              </button>
              {onEditGroup && <button type="button" className="todo-thread-settings" onClick={() => onEditGroup(list)} aria-label={`${list.title} 그룹 관리`}><Settings2 /></button>}
            </div>
            {isExpanded && <div className="todo-thread-items">{visibleMembers.map((todo) => <div className="todo-thread-node" key={todo.id}>{renderTodo(todo)}</div>)}</div>}
          </section>
        );
      })}

      {visibleUngrouped.length > 0 && (
        <section className="ungrouped-todos">
          {groups.length > 0 && <div className="ungrouped-heading"><span>그룹 없는 TODO</span><small>{visibleUngrouped.length}개</small></div>}
          <div className="todo-stack compact">{visibleUngrouped.map((todo) => renderTodo(todo))}</div>
        </section>
      )}
    </div>
  );
}
