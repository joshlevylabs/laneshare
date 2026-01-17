'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  GitBranch,
  ListTodo,
  FileText,
  Settings,
  Search,
  Boxes,
  Plug,
  Terminal,
  Sparkles,
} from 'lucide-react'

interface ProjectSidebarProps {
  projectId: string
}

const navItems = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    title: 'Tasks',
    href: '/tasks',
    icon: ListTodo,
  },
  {
    title: 'Sidequests',
    href: '/sidequests',
    icon: Sparkles,
  },
  {
    title: 'Workspace',
    href: '/workspace',
    icon: Terminal,
  },
  {
    title: 'Search',
    href: '/search',
    icon: Search,
  },
  {
    title: 'Systems',
    href: '/systems',
    icon: Boxes,
  },
  {
    title: 'Documentation',
    href: '/documents',
    icon: FileText,
  },
  {
    title: 'Repositories',
    href: '/repos',
    icon: GitBranch,
  },
  {
    title: 'Services',
    href: '/services',
    icon: Plug,
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
  },
]

export function ProjectSidebar({ projectId }: ProjectSidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="w-64 border-r bg-muted/10 min-h-[calc(100vh-3.5rem)]">
      <nav className="p-4 space-y-1">
        {navItems.map((item) => {
          const href = `/projects/${projectId}${item.href}`
          const isActive = pathname === href || pathname.startsWith(`${href}/`)

          return (
            <Link
              key={item.href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
