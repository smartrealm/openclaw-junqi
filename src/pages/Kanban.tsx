// Kanban Board — drag-and-drop task management.
// Mirrors hermes-studio KanbanView design, powered by workshop store.
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCorners, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Trash2, GripVertical, AlertCircle, Clock, CheckCircle2, Play, Pause, Archive, ArrowRight, Loader2 } from 'lucide-react';
import { useWorkshopStore, type Task } from '@/stores/workshopStore';
import clsx from 'clsx';

// ── Kanban column definitions ──
interface Column {
  id: Task['status'];
  label: string;
  icon: any;
  color: string;
  bg: string;
}

const COLUMNS: Column[] = [
  { id: 'queue',      label: '待处理',  icon: Clock,        color: 'text-slate-400',  bg: 'bg-slate-500/5' },
  { id: 'inProgress', label: '进行中',  icon: Play,         color: 'text-blue-400',   bg: 'bg-blue-500/5' },
  { id: 'review',     label: '审查',    icon: AlertCircle,  color: 'text-purple-400', bg: 'bg-purple-500/5' },
  { id: 'done',       label: '已完成',  icon: CheckCircle2, color: 'text-emerald-400',bg: 'bg-emerald-500/5' },
];

const PRIORITY_COLORS: Record<string, string> = { high: 'border-red-400/40', medium: 'border-amber-400/40', low: 'border-slate-400/20' };

function TaskCard({ task }: { task: Task }) {
  const { t } = useTranslation();
  const deleteTask = useWorkshopStore(s => s.deleteTask);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style}
      className={clsx(
        'rounded-lg border bg-aegis-surface/80 p-3 cursor-default transition-shadow hover:shadow-md',
        PRIORITY_COLORS[task.priority] || 'border-aegis-border/30'
      )}
    >
      <div className="flex items-start gap-2">
        <button {...attributes} {...listeners} className="mt-0.5 p-0.5 rounded hover:bg-[rgb(var(--aegis-overlay)/0.08)] cursor-grab active:cursor-grabbing touch-none">
          <GripVertical size={12} className="text-aegis-text-dim" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-aegis-text leading-snug">{task.title}</div>
          {task.description && (
            <div className="text-[10px] text-aegis-text-dim mt-1 line-clamp-2">{task.description}</div>
          )}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {task.tags?.map(tag => (
              <span key={tag} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[rgb(var(--aegis-overlay)/0.06)] text-aegis-text-dim">{tag}</span>
            ))}
            {task.assignedAgent && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-aegis-primary/10 text-aegis-primary">{task.assignedAgent}</span>
            )}
          </div>
        </div>
        <button onClick={() => deleteTask(task.id)} className="p-0.5 rounded opacity-0 hover:opacity-100 group-hover/card:opacity-60 hover:bg-aegis-danger/10 text-aegis-text-dim hover:text-aegis-danger transition-all shrink-0">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

function KanbanColumn({ column, tasks }: { column: Column; tasks: Task[] }) {
  const { t } = useTranslation();
  const addTask = useWorkshopStore(s => s.addTask);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const Icon = column.icon;

  const handleAdd = () => {
    const title = newTitle.trim();
    if (!title) return;
    addTask({ title, description: '', priority: 'medium', assignedAgent: undefined, tags: [] });
    setNewTitle('');
    setAdding(false);
  };

  return (
    <div className="flex flex-col w-[280px] shrink-0">
      {/* Column header */}
      <div className={clsx('flex items-center gap-2 px-3 py-2.5 rounded-xl mb-2', column.bg)}>
        <Icon size={14} className={column.color} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-aegis-text-muted">{column.label}</span>
        <span className="ml-auto text-[10px] font-mono text-aegis-text-dim">{tasks.length}</span>
        <button onClick={() => setAdding(true)} className="p-0.5 rounded hover:bg-[rgb(var(--aegis-overlay)/0.08)] text-aegis-text-dim">
          <Plus size={13} />
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="mb-2 p-2 rounded-lg border border-aegis-border/40 bg-aegis-surface">
          <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="任务标题…" className="w-full bg-transparent text-[11px] text-aegis-text outline-none mb-1.5" />
          <div className="flex gap-1.5">
            <button onClick={handleAdd} className="px-2 py-0.5 rounded text-[10px] font-semibold bg-aegis-primary/15 text-aegis-primary">添加</button>
            <button onClick={() => setAdding(false)} className="px-2 py-0.5 rounded text-[10px] text-aegis-text-muted">取消</button>
          </div>
        </div>
      )}

      {/* Tasks */}
      <div className="flex-1 space-y-1.5 min-h-[100px] overflow-y-auto scrollbar-hidden">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => <TaskCard key={task.id} task={task} />)}
        </SortableContext>
      </div>
    </div>
  );
}

export function Kanban() {
  const { t } = useTranslation();
  const tasks = useWorkshopStore(s => s.tasks);
  const moveTask = useWorkshopStore(s => s.moveTask);
  const reorderInColumn = useWorkshopStore(s => s.reorderInColumn);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const columns = useMemo(() => {
    return COLUMNS.map(col => ({
      ...col,
      tasks: tasks.filter(t => t.status === col.id),
    }));
  }, [tasks]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Find target column
    const overCol = COLUMNS.find(c => c.id === over.id);
    if (overCol) {
      moveTask(taskId, overCol.id);
      return;
    }

    // Find task being dropped on
    const overTask = tasks.find(t => t.id === over.id);
    if (overTask && task.status === overTask.status) {
      const colTasks = tasks.filter(t => t.status === task.status);
      const orderedIds = colTasks.map(t => t.id);
      const fromIdx = orderedIds.indexOf(taskId);
      const toIdx = orderedIds.indexOf(overTask.id);
      if (fromIdx !== -1 && toIdx !== -1) {
        orderedIds.splice(fromIdx, 1);
        orderedIds.splice(toIdx, 0, taskId);
        reorderInColumn(task.status, orderedIds);
      }
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-aegis-border/50 shrink-0">
        <h1 className="text-sm font-bold text-aegis-text">{t('nav.kanban', '看板')}</h1>
        <span className="text-[10px] text-aegis-text-dim font-mono">{tasks.length} 任务</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-x-auto p-6">
          <div className="flex gap-4 h-full items-start">
            {columns.map(col => (
              <KanbanColumn key={col.id} column={col} tasks={col.tasks} />
            ))}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

export default Kanban;
