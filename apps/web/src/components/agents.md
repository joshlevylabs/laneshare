# UI Components - Agent Context

## Overview

React components organized by feature domain. Built with shadcn/ui (Radix primitives), Tailwind CSS, and TypeScript.

## Directory Structure

```
components/
├── agent-prompts/      # AI agent prompt generation UI
├── documents/          # Document management (viewer, editor, builder)
├── docs/               # Legacy documentation viewer
├── prd/                # Product Requirements Document components
├── projects/           # Project creation and navigation
├── repo-docs/          # Auto-generated repository documentation
├── repos/              # Repository management
├── services/           # Service connection dialogs
├── settings/           # Project settings and team management
├── systems/            # Architecture visualization (ReactFlow)
├── tasks/              # Task management (board, views, dialogs)
├── ui/                 # Shared UI primitives (shadcn/ui)
└── workspace/          # Workspace collaboration
```

## Component Patterns

### Dialog Components

Most feature dialogs follow this pattern:

```tsx
interface CreateXDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (item: X) => void;
}

export function CreateXDialog({ projectId, open, onOpenChange, onCreated }: CreateXDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/x`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!response.ok) throw new Error('Failed');
      const data = await response.json();
      onCreated?.(data);
      onOpenChange(false);
    } catch (error) {
      // Handle error
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ... */}
    </Dialog>
  );
}
```

### List/View Components

```tsx
interface XListProps {
  projectId: string;
  items: X[];
  onItemClick?: (item: X) => void;
  onRefresh?: () => void;
}
```

## Key Component Groups

### Tasks (`/tasks/`)
- `task-board.tsx` - Main Kanban board with drag-and-drop (@dnd-kit)
- `task-card.tsx` - Individual task card component
- `task-detail-modal.tsx` - Full task detail view
- `create-task-dialog.tsx` / `edit-task-dialog.tsx` - Task CRUD dialogs
- `views/` - Alternative views (board, table, timeline, backlog)

### Systems (`/systems/`)
- `systems-list-view.tsx` - List of architecture systems
- `system-detail-view.tsx` - Single system with flowchart
- `flowchart-builder.tsx` - ReactFlow-based diagram editor
- `node-palette.tsx` - Draggable node types
- `editable-system-node.tsx` - Custom node component

### Services (`/services/`)
- `service-connection-card.tsx` - Display connected service
- `connect-supabase-dialog.tsx` - Supabase connection wizard
- `connect-vercel-dialog.tsx` - Vercel OAuth flow
- `connect-openapi-dialog.tsx` - OpenAPI spec import

### Documents (`/documents/`)
- Document viewer with markdown rendering
- Document builder wizard (multi-step)
- Reference linking UI

## UI Primitives (`/ui/`)

Based on shadcn/ui. Key components:
- `button.tsx`, `input.tsx`, `textarea.tsx`
- `dialog.tsx`, `sheet.tsx`, `dropdown-menu.tsx`
- `tabs.tsx`, `card.tsx`, `badge.tsx`
- `select.tsx`, `checkbox.tsx`, `radio-group.tsx`
- `toast.tsx`, `toaster.tsx` - Toast notifications

## Styling Conventions

- Use Tailwind CSS utility classes
- Follow shadcn/ui patterns for variants
- Use `cn()` utility for conditional classes:

```tsx
import { cn } from '@/lib/utils';

<div className={cn(
  'base-classes',
  condition && 'conditional-classes',
  className
)} />
```

## State Management

- Local state with `useState` / `useReducer`
- Server state via fetch + manual refresh
- No global state library (rely on prop drilling and URL state)

## Common Imports

```tsx
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
```

## ReactFlow (Systems)

For architecture diagrams:

```tsx
import ReactFlow, {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
} from 'reactflow';
import 'reactflow/dist/style.css';
```
